import { randomBytes } from "crypto";
import { prisma, redis, type Prisma } from "@funtush/database";
import { generateOTP } from "@funtush/auth";
import { sendAlternativeDateEmail, sendBookingAcceptedEmail, sendBookingRejectedEmail, sendOtpEmail } from "../utils/email";
import { sendInquiryConfirmationEmail, sendAgencyInquiryAlertEmail } from "../utils/email";
import { notifyAgencyAdmins, notifyTrekker } from "./notification.service.js";
import { confirmSlotsForBooking } from "./departureDate.service.js";
import { recordConversion } from "./marketplaceAnalytics.service.js";

//Types
export interface InquiryInput {
  packageId: string;
  departureDateId: string;
  groupSize: number;
  addOns?: { addOnId: string; quantity: number }[];
  trekkerName: string;
  trekkerEmail: string;
  trekkerPhone: string;
  trekkerCountry?: string;
  specialRequests?: string;
}

// Redis key helpers
const otpKey = (token: string) => `inquiry:otp:${token}`;
const dataKey = (token: string) => `inquiry:data:${token}`;
const TTL = 15 * 60;

//  validate, store temp, send OTP 
export async function submitInquiry(input: InquiryInput) {
  const { packageId, departureDateId, groupSize, trekkerEmail } = input;

  // Validate package exists and belongs to an active agency
  const pkg = await prisma.trekPackage.findUnique({
    where: { id: packageId },
    include: { agency: true },
  });

  if (!pkg || pkg.status !== "PUBLISHED") {
    throw new Error("Package not available");
  }

  if (["LOCKED", "SUSPENDED"].includes(pkg.agency.status)) {
    throw new Error("Package not available");
  }

  // Check departure date availability
  const departure = await prisma.trekDepartureDate.findUnique({
    where: { id: departureDateId },
  });

  if (!departure || departure.packageId !== packageId) {
    throw new Error("Invalid departure date");
  }

  if (departure.status === "FULL") {
    throw new Error("This departure date is full");
  }

  const available = departure.maxSlots - departure.bookedSlots;
  if (groupSize > available) {
    throw new Error(`Only ${available} slot(s) available for this departure`);
  }

  // Validate add-ons belong to this package
  if (input.addOns?.length) {
    const addOnIds = input.addOns.map((a) => a.addOnId);
    const validAddOns = await prisma.trekAddOn.findMany({
      where: { id: { in: addOnIds }, packageId },
    });
    if (validAddOns.length !== addOnIds.length) {
      throw new Error("One or more add-ons are invalid");
    }
  }

  // Calculate total price
  const addOnsWithPrice = input.addOns?.length
    ? await prisma.trekAddOn.findMany({
      where: { id: { in: input.addOns.map((a) => a.addOnId) } },
    })
    : [];

  const basePrice = Number(pkg.pricePerPerson) * groupSize;
  const addOnTotal = addOnsWithPrice.reduce((sum: number, addOn: { id: string; price: unknown; perPerson: boolean }) => {
    const line = input.addOns!.find((a) => a.addOnId === addOn.id)!;
    const qty = line.quantity;
    return sum + Number(addOn.price) * (addOn.perPerson ? groupSize * qty : qty);
  }, 0);

  const totalPrice = basePrice + addOnTotal;

  // Generate a session token to tie OTP → inquiry data
  const { randomBytes } = await import("crypto");
  const sessionToken = randomBytes(20).toString("hex");

  // Store temp inquiry data in Redis (expires with OTP)
  await redis.set(
    dataKey(sessionToken),
    JSON.stringify({ ...input, agencyId: pkg.agencyId, totalPrice }),
    "EX",
    TTL
  );

  // Generate and store OTP
  const otp = generateOTP();
  await redis.set(otpKey(sessionToken), otp, "EX", TTL);

  // Send OTP email
  await sendOtpEmail(trekkerEmail, otp);

  return {
    sessionToken,
    expiresInSeconds: TTL,
    message: "OTP sent to your email. Please verify to complete your inquiry.",
  };
}

// verify OTP → save inquiry to DB 
export async function verifyInquiryOtp(sessionToken: string, otp: string) {
  // Retrieve and validate OTP
  const storedOtp = await redis.get(otpKey(sessionToken));

  if (!storedOtp) {
    throw new Error("OTP expired or invalid session");
  }

  if (storedOtp !== otp) {
    throw new Error("Incorrect OTP");
  }

  // Retrieve temp inquiry data
  const raw = await redis.get(dataKey(sessionToken));
  if (!raw) {
    throw new Error("Session data expired");
  }

  const data: InquiryInput & { agencyId: string; totalPrice: number } =
    JSON.parse(raw);

  // Re-check availability (slots may have changed during OTP window)
  const departure = await prisma.trekDepartureDate.findUnique({
    where: { id: data.departureDateId },
  });

  if (!departure) throw new Error("Departure date no longer exists");

  const available = departure.maxSlots - departure.bookedSlots;
  if (data.groupSize > available) {
    throw new Error("Sorry, this departure is no longer available");
  }

  // Save booking to DB with status INQUIRY
  const booking = await prisma.booking.create({
    data: {
      agencyId: data.agencyId,
      packageId: data.packageId,
      departureDateId: data.departureDateId,
      groupSize: data.groupSize,
      totalPrice: data.totalPrice,
      status: "INQUIRY",
      trekkerName: data.trekkerName,
      trekkerEmail: data.trekkerEmail,
      trekkerPhone: data.trekkerPhone,
      trekkerCountry: data.trekkerCountry,
      specialRequests: data.specialRequests,
      // addOns saved separately below
    },
    include: {
      package: { include: { agency: true } },
      departureDate: true,
    },
  });
  // Record marketplace conversion 
  try {
    await recordConversion(data.agencyId);
  } catch (err) {
    console.error(
      `Failed to record marketplace conversion for agency ${data.agencyId}:`,
      err
    );
  }

  // Save add-ons snapshot
  if (data.addOns?.length) {
    const addOns = await prisma.trekAddOn.findMany({
      where: { id: { in: data.addOns.map((a) => a.addOnId) } },
    });

    await prisma.bookingAddOn.createMany({
      data: data.addOns.map((a) => {
        const addOn = addOns.find((x: { id: string }) => x.id === a.addOnId)!;
        return {
          bookingId: booking.id,
          addOnId: a.addOnId,
          quantity: a.quantity,
          priceAtBooking: addOn.price,
        };
      }),
    });
  }

  // Clean up Redis
  await redis.del(otpKey(sessionToken));
  await redis.del(dataKey(sessionToken));

  // Send trekker confirmation email
  await sendInquiryConfirmationEmail(
    data.trekkerEmail,
    data.trekkerName,
    booking.package.title,
    booking.departureDate.startDate,
  );

  // Notify agency (email — push notification stubbed for now)
  await sendAgencyInquiryAlertEmail(
    booking.package.agency.email,
    data.trekkerName,
    booking.package.title,
    booking.id,
  );

  await notifyAgencyAdmins(data.agencyId, {
    title: "New Inquiry Received",
    body: `New inquiry from ${data.trekkerName} for ${booking.package.title}`,
    data: {
      bookingId: booking.id,
      type: "NEW_INQUIRY",
      link: `/dashboard/bookings/${booking.id}`,
    },
  });

  return {
    bookingId: booking.id,
    status: "INQUIRY",
    message: "Your inquiry has been submitted. The agency will confirm within 24 hours.",
  };
}

// GET /agencies/me/bookings
export async function getAgencyBookings(
  agencyId: string,
  status?: string,
  page = 1,
  limit = 20,
) {
  const where = {
    agencyId,
    ...(status ? { status: status as string } : {}),
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        package: { select: { title: true, slug: true } },
        departureDate: { select: { startDate: true } },
        addOns: { include: { addOn: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return { bookings, total, page, limit };
}

// PATCH /bookings/:id/accept
export async function acceptBooking(bookingId: string, agencyId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { package: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.agencyId !== agencyId) throw new Error("Unauthorized");
  if (booking.status !== "INQUIRY") throw new Error("Booking is not in INQUIRY state");

  const urlToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  // Confirm the booking, book the seats, and issue the payment link as ONE atomic
  // unit. confirmSlotsForBooking re-checks capacity under the transaction and flips
  // the date to FULL when this booking fills it — so two agencies confirming the
  // last seats can't both succeed (no overbooking).
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await confirmSlotsForBooking(tx, booking.departureDateId, booking.groupSize);
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    });
    await tx.paymentLink.create({
      data: {
        bookingId,
        urlToken,
        amount: booking.totalPrice,
        expiresAt,
      },
    });
  });

  const paymentUrl = `${process.env.APP_URL}/pay/${urlToken}`;

  await sendBookingAcceptedEmail(
    booking.trekkerEmail,
    booking.trekkerName,
    booking.package.title,
    paymentUrl,
    expiresAt,
  );

  if (booking.trekkerId) {
    await notifyTrekker(booking.trekkerId, {
      title: "Booking Confirmed!",
      body: `Your booking for ${booking.package.title} has been confirmed. Please complete payment within 48 hours.`,
      data: { bookingId, type: "BOOKING_CONFIRMED", link: `/bookings/${bookingId}` },
    });
  }

  return { bookingId, status: "CONFIRMED", paymentUrl, expiresAt };
}

// PATCH /bookings/:id/reject
export async function rejectBooking(
  bookingId: string,
  agencyId: string,
  reason: string,
) {
  if (!reason?.trim()) throw new Error("Rejection reason is required");

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { package: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.agencyId !== agencyId) throw new Error("Unauthorized");
  if (!["INQUIRY", "CONFIRMED"].includes(booking.status)) {
    throw new Error("Booking cannot be rejected in its current state");
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "REJECTED", rejectionReason: reason },
  });

  await sendBookingRejectedEmail(
    booking.trekkerEmail,
    booking.trekkerName,
    booking.package.title,
    reason,
  );

  if (booking.trekkerId) {
    await notifyTrekker(booking.trekkerId, {
      title: "Booking Update",
      body: `Your inquiry for ${booking.package.title} was not accepted.`,
      data: { bookingId, type: "BOOKING_REJECTED", link: `/bookings/${bookingId}` },
    });
  }

  return { bookingId, status: "REJECTED" };
}

// PATCH /bookings/:id/propose-date
export async function proposeAlternativeDate(
  bookingId: string,
  agencyId: string,
  proposedDate: string,
) {
  if (!proposedDate) throw new Error("Proposed date is required");

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { package: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.agencyId !== agencyId) throw new Error("Unauthorized");
  if (booking.status !== "INQUIRY") throw new Error("Booking is not in INQUIRY state");

  const date = new Date(proposedDate);
  if (isNaN(date.getTime())) throw new Error("Invalid date format");

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "ALTERNATIVE_PROPOSED",
      proposedDate: date,
    },
  });

  await sendAlternativeDateEmail(
    booking.trekkerEmail,
    booking.trekkerName,
    booking.package.title,
    date,
  );

  if (booking.trekkerId) {
    await notifyTrekker(booking.trekkerId, {
      title: "Alternative Date Proposed",
      body: `The agency has proposed a new date for ${booking.package.title}.`,
      data: { bookingId, type: "ALTERNATIVE_PROPOSED", link: `/bookings/${bookingId}` },
    });
  }

  return { bookingId, status: "ALTERNATIVE_PROPOSED", proposedDate: date };
}