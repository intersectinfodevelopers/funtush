import { randomBytes } from "crypto";
import { prisma, redis, type Prisma } from "@funtush/database";
import { generateOTP } from "@funtush/auth";
import { sendAlternativeDateEmail, sendBookingAcceptedEmail, sendBookingRejectedEmail, sendOtpEmail } from "../utils/email";
import { sendInquiryConfirmationEmail, sendAgencyInquiryAlertEmail } from "../utils/email";
import { notifyAgencyAdmins, notifyTrekker } from "./notification.service.js";
import { confirmSlotsForBooking, releaseSlotsForBooking } from "./departureDate.service.js";
import { recordConversion } from "./marketplaceAnalytics.service.js";
import { validateAndApplyCoupon } from "./coupon.service";
import { trackBooking } from "./prometheusMetrics";
import { trackEvent } from "./analytics.service";
import { discountedPricePerPerson } from "../utils/validator";
import { assertGuideAssignable, markGuideBusy, releaseIdleGuides } from "./guideAvailability.service";

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

  couponCode?: string;
}

// Redis key helpers
const otpKey = (token: string) => `inquiry:otp:${token}`;
const dataKey = (token: string) => `inquiry:data:${token}`;
const TTL = 15 * 60;

const INQUIRY_EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
const inq = (m: string): never => {
  throw Object.assign(new Error(m), { status: 400 });
};

/**
 * A public, unauthenticated form: validate everything strictly before it reaches pricing, Redis or an
 * email. (Negative/fractional group sizes, oversized text and junk add-on lists used to flow straight through.)
 */
function validateInquiryInput(input: InquiryInput) {
  const str = (v: unknown, label: string, min: number, max: number) => {
    if (typeof v !== "string" || v.trim().length < min || v.trim().length > max) return inq(`${label} must be ${min}-${max} characters.`);
    if (/[<>]/.test(v)) return inq(`${label} must not contain < or >.`);
    return v.trim();
  };
  if (typeof input?.packageId !== "string" || !input.packageId) inq("packageId is required.");
  if (typeof input.departureDateId !== "string" || !input.departureDateId) inq("departureDateId is required.");
  if (!Number.isInteger(input.groupSize) || input.groupSize < 1 || input.groupSize > 50) inq("Group size must be a whole number from 1 to 50.");
  str(input.trekkerName, "Name", 2, 100);
  if (typeof input.trekkerEmail !== "string" || input.trekkerEmail.length > 254 || !INQUIRY_EMAIL_RE.test(input.trekkerEmail.trim())) inq("Enter a valid email address.");
  if (typeof input.trekkerPhone !== "string" || !/^[+()\d][\d\s()+.-]{6,24}$/.test(input.trekkerPhone.trim())) inq("Enter a valid phone number.");
  if (input.trekkerCountry !== undefined && input.trekkerCountry !== null && input.trekkerCountry !== "") str(input.trekkerCountry, "Country", 2, 60);
  if (input.specialRequests !== undefined && input.specialRequests !== null && input.specialRequests !== "") str(input.specialRequests, "Special requests", 1, 1000);
  if (input.couponCode !== undefined && input.couponCode !== null && input.couponCode !== "") str(input.couponCode, "Coupon code", 1, 40);
  if (input.addOns !== undefined) {
    if (!Array.isArray(input.addOns) || input.addOns.length > 20) inq("Add-ons must be a list of at most 20.");
    for (const a of input.addOns) {
      if (!a || typeof a.addOnId !== "string" || !Number.isInteger(a.quantity) || a.quantity < 1 || a.quantity > 50) inq("Each add-on needs an id and a quantity from 1 to 50.");
    }
  }
}

/** At most `max` events per key per window; used so this public form can't be turned into an email cannon. */
async function inquiryRateLimit(key: string, max: number, windowSeconds: number) {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSeconds);
  if (n > max) throw Object.assign(new Error("Too many requests. Please try again later."), { status: 429 });
}

const MAX_INQUIRY_OTP_ATTEMPTS = 5;

//  validate, store temp, send OTP 
export async function submitInquiry(input: InquiryInput) {
  validateInquiryInput(input);
  const { packageId, departureDateId, groupSize, trekkerEmail } = input;
  // One address can be sent a code 5 times an hour, and one package's form 200 times an hour.
  await inquiryRateLimit(`inquiry:rl:email:${trekkerEmail.trim().toLowerCase()}`, 5, 3600);
  await inquiryRateLimit(`inquiry:rl:pkg:${packageId}`, 200, 3600);

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

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  if (departure.startDate < todayStart) {
    throw new Error("This departure date has already passed");
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

  const basePrice = discountedPricePerPerson(Number(pkg.pricePerPerson), pkg.volumeDiscounts, groupSize) * groupSize;
  const addOnTotal = addOnsWithPrice.reduce((sum: number, addOn: { id: string; price: unknown; perPerson: boolean }) => {
    const line = input.addOns!.find((a) => a.addOnId === addOn.id)!;
    const qty = line.quantity;
    return sum + Number(addOn.price) * (addOn.perPerson ? groupSize * qty : qty);
  }, 0);

  const totalPrice = basePrice + addOnTotal;

  /**coupon */
  let finalPrice = totalPrice;
  let couponData:
    | {
      couponId: string;
      couponCode: string;
      discount: number;
    }
    | null = null;

  if (input.couponCode) {
    const couponResult = await validateAndApplyCoupon({
      couponCode: input.couponCode,
      packageId,
      bookingValue: totalPrice,
      groupSize,
      trekkerEmail
    });

    finalPrice = couponResult.finalAmount;

    couponData = {
      couponId: couponResult.couponId,
      discount: couponResult.discount,
      couponCode: couponResult.couponCode
    };
  }
  /** */

  // Generate a session token to tie OTP → inquiry data
  const { randomBytes } = await import("crypto");
  const sessionToken = randomBytes(20).toString("hex");

  // Store temp inquiry data in Redis (expires with OTP)
  await redis.set(
    dataKey(sessionToken),
    JSON.stringify({
      ...input, agencyId: pkg.agencyId, totalPrice,
      finalPrice,
      couponData
    }),
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

  // A 6-digit code must not be brute-forceable: after a few wrong tries the whole inquiry is discarded.
  const attemptsKey = `inquiry:attempts:${sessionToken}`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, TTL);
  if (attempts > MAX_INQUIRY_OTP_ATTEMPTS) {
    await redis.del(otpKey(sessionToken), dataKey(sessionToken), attemptsKey);
    throw new Error("Too many incorrect attempts (expired) — please start your inquiry again.");
  }

  if (storedOtp !== otp) {
    throw new Error("Incorrect OTP");
  }

  // Retrieve temp inquiry data
  const raw = await redis.get(dataKey(sessionToken));
  if (!raw) {
    throw new Error("Session data expired");
  }

  const data: InquiryInput & {
    agencyId: string;
    totalPrice: number;
    finalPrice?: number;
    couponData?: {
      couponId: string;
      discount: number;
      couponCode: string;
    };
  } =
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
      totalPrice: data.finalPrice ?? data.totalPrice,
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

  void trackEvent({
    agency_id: data.agencyId,
    event_type: "INQUIRY_SUBMITTED",
    trekker_id: null,
    package_id: data.packageId,
    metadata: { booking_id: booking.id },
  });

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

  /**Increment coupon redemption */
  if (data.couponData?.couponId) {

    await prisma.coupon.update({
      where: {
        id: data.couponData.couponId
      },
      data: {
        redemptionsUsed: {
          increment: 1
        }
      }
    });

  }
  /** */


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

  trackBooking("INQUIRY");
  return {
    bookingId: booking.id,
    status: "INQUIRY",
    message: "Your inquiry has been submitted. The agency will confirm within 24 hours.",
  };
}

const BOOKING_STATUSES = [
  "INQUIRY", "CONFIRMED", "PAYMENT_PENDING", "REJECTED",
  "ALTERNATIVE_PROPOSED", "PAID", "ACTIVE", "COMPLETED", "CANCELLED",
] as const;

// GET /agencies/me/bookings
export interface BookingFilters {
  /** Case-insensitive match on the trekker's name or email. */
  search?: string;
  /** Departure date range (inclusive), YYYY-MM-DD. */
  from?: string;
  to?: string;
}

export async function getAgencyBookings(
  agencyId: string,
  /** One status, or several comma-separated ("INQUIRY,ALTERNATIVE_PROPOSED"). */
  status?: string,
  page = 1,
  limit = 20,
  filters: BookingFilters = {},
) {
  // An unrecognised ?status= would otherwise reach Prisma as an invalid enum and
  // surface as a 500. Reject it as a client error instead.
  const statuses = status
    ? status.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [];
  if (statuses.some((s) => !BOOKING_STATUSES.includes(s as (typeof BOOKING_STATUSES)[number]))) {
    throw bookingErr(400, `Invalid status filter. Expected one of: ${BOOKING_STATUSES.join(", ")}`);
  }

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if ((filters.from && !dateOnly.test(filters.from)) || (filters.to && !dateOnly.test(filters.to))) {
    throw bookingErr(400, "from/to must be YYYY-MM-DD");
  }
  const search = filters.search?.trim().slice(0, 100);

  const where: Prisma.BookingWhereInput = {
    agencyId,
    ...(statuses.length ? { status: { in: statuses as Prisma.EnumBookingStatusFilter["in"] } } : {}),
    ...(search
      ? {
          OR: [
            { trekkerName: { contains: search, mode: "insensitive" } },
            { trekkerEmail: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.from || filters.to
      ? {
          departureDate: {
            startDate: {
              ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
              ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {}),
            },
          },
        }
      : {}),
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      // id tie-breaker: bookings created in the same instant would otherwise
      // sort arbitrarily and could repeat/vanish across pages.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        package: { select: { title: true, slug: true, currency: true } },
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
      data: { status: "PAYMENT_PENDING" },
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
      title: "Booking Accepted — Payment Required",
      body: `Please complete payment for ${booking.package.title} within 48 hours to confirm your booking.`,
      data: { bookingId, type: "PAYMENT_REQUIRED", link: `/bookings/${bookingId}` },
    });
  }

  trackBooking("PAYMENT_PENDING");
  return { bookingId, status: "PAYMENT_PENDING", paymentUrl, expiresAt };
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
  // Rejectable while it's still just a request — including after the agency
  // proposed an alternative date the trekker never took up.
  if (!["INQUIRY", "ALTERNATIVE_PROPOSED"].includes(booking.status)) {
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

  trackBooking("REJECTED");
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

// PATCH /bookings/:id/confirm — final agency sign-off after payment.
export async function confirmBooking(bookingId: string, agencyId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { package: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.agencyId !== agencyId) throw new Error("Unauthorized");
  if (booking.status !== "PAID") throw new Error("Booking is not in PAID state");

  await prisma.booking.update({ where: { id: bookingId }, data: { status: "CONFIRMED" } });

  if (booking.trekkerId) {
    await notifyTrekker(booking.trekkerId, {
      title: "Booking Confirmed!",
      body: `Your booking for ${booking.package.title} is fully confirmed. See you on the trail!`,
      data: { bookingId, type: "BOOKING_CONFIRMED", link: `/bookings/${bookingId}` },
    });
  }

  trackBooking("CONFIRMED");
  void trackEvent({
    agency_id: agencyId,
    event_type: "BOOKING_CONFIRMED",
    trekker_id: booking.trekkerId,
    package_id: booking.packageId,
    metadata: { booking_id: bookingId },
  });
  return { bookingId, status: "CONFIRMED" };
}

// PATCH /bookings/:id/cancel — post-acceptance cancellation (slots reserved
// and/or payment may already exist, unlike reject).
export async function cancelBooking(bookingId: string, agencyId: string, reason: string) {
  if (!reason?.trim()) throw new Error("Cancellation reason is required");

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { package: true, paymentLink: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.agencyId !== agencyId) throw new Error("Unauthorized");

  // Only these states hold reserved seats (accept / manual-confirm reserve them);
  // INQUIRY and ALTERNATIVE_PROPOSED do not, so cancelling them must NOT release
  // slots or it would steal a seat from another booking.
  const slotsReserved = ["PAYMENT_PENDING", "PAID", "CONFIRMED", "ACTIVE"];
  const cancellableFrom = [...slotsReserved, "INQUIRY", "ALTERNATIVE_PROPOSED"];
  if (!cancellableFrom.includes(booking.status)) {
    throw new Error("Booking cannot be cancelled in its current state");
  }
  const shouldRelease = slotsReserved.includes(booking.status);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (shouldRelease) {
      await releaseSlotsForBooking(tx, booking.departureDateId, booking.groupSize);
    }
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED", rejectionReason: reason },
    });
  });


  // TODO: if booking.paymentLink?.used, trigger refund via payment gateway — not implemented.

  await sendBookingRejectedEmail(booking.trekkerEmail, booking.trekkerName, booking.package.title, reason);

  if (booking.trekkerId) {
    await notifyTrekker(booking.trekkerId, {
      title: "Booking Cancelled",
      body: `Your booking for ${booking.package.title} has been cancelled.${booking.paymentLink?.used ? " A refund will be processed." : ""
        }`,
      data: { bookingId, type: "BOOKING_CANCELLED", link: `/bookings/${bookingId}` },
    });
  }

  trackBooking("CANCELLED");
  void trackEvent({
    agency_id: agencyId,
    event_type: "BOOKING_CANCELLED",
    trekker_id: booking.trekkerId,
    package_id: booking.packageId,
    metadata: { booking_id: bookingId, reason },
  });
  return { bookingId, status: "CANCELLED" };
}

// GET /agencies/me/bookings/:id — single booking detail.
export async function getBookingById(bookingId: string, agencyId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      package: { select: { title: true, slug: true, currency: true } },
      departureDate: { select: { startDate: true } },
      addOns: { include: { addOn: true } },
      paymentLink: true,
    },
  });

  if (!booking || booking.agencyId !== agencyId) {
    throw new Error("Booking not found");
  }

  return booking;
}

// PATCH /bookings/:id/assign-guide — requires CONFIRMED status
export async function assignGuide(bookingId: string, agencyId: string, guideRef: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });

  if (!booking) throw new Error("Booking not found");
  if (booking.agencyId !== agencyId) throw new Error("Unauthorized");
  if (booking.status !== "CONFIRMED") throw new Error("Booking must be CONFIRMED to assign a guide");

  // Validate the guide actually exists, belongs to this agency, and is active.
  const guide = await prisma.guideProfile.findUnique({
    where: { agencyId_guideRef: { agencyId, guideRef } },
  });
  if (!guide || !guide.isActive) throw new Error("Guide not found or inactive");

  // One trek at a time: a guide who is on a different departure can't be taken until they're free.
  await assertGuideAssignable(agencyId, guideRef, booking.departureDateId, bookingId);

  await prisma.booking.update({
    where: { id: bookingId },
    data: { assignedGuideId: guideRef },
  });
  await markGuideBusy(agencyId, guideRef);
  if (booking.assignedGuideId && booking.assignedGuideId !== guideRef) await releaseIdleGuides(agencyId); // the guide they replaced may now be free

  return { bookingId, assignedGuideId: guideRef };
}

// PATCH /bookings/:id/check-in — CONFIRMED → ACTIVE 
export async function checkInBooking(bookingId: string, agencyId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { package: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.agencyId !== agencyId) throw new Error("Unauthorized");
  if (booking.status !== "CONFIRMED") throw new Error("Booking must be CONFIRMED to check in");
  if (!booking.assignedGuideId) throw new Error("Assign a guide before checking in");

  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "ACTIVE" },
  });

  if (booking.trekkerId) {
    await notifyTrekker(booking.trekkerId, {
      title: "Trek Started",
      body: `Your trek for ${booking.package.title} has begun. Have a great trip!`,
      data: { bookingId, type: "TREK_STARTED", link: `/bookings/${bookingId}` },
    });
  }

  trackBooking("ACTIVE");
  return { bookingId, status: "ACTIVE" };
}

// PATCH /bookings/:id/check-out — ACTIVE → COMPLETED
export async function checkOutBooking(bookingId: string, agencyId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { package: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.agencyId !== agencyId) throw new Error("Unauthorized");
  if (booking.status !== "ACTIVE") throw new Error("Booking must be ACTIVE to check out");

  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "COMPLETED" },
  });

  if (booking.trekkerId) {
    await notifyTrekker(booking.trekkerId, {
      title: "Trek Completed",
      body: `Your trek for ${booking.package.title} is complete. We'd love your feedback!`,
      data: { bookingId, type: "TREK_COMPLETED", link: `/bookings/${bookingId}` },
    });
  }

  trackBooking("COMPLETED");
  return { bookingId, status: "COMPLETED" };
}
// ── Phase 2: agency-side manual booking creation ───────────────────────────────
//
// The trekker inquiry flow (submitInquiry → OTP → verifyInquiryOtp) is for the
// public marketplace. Agencies also take bookings over the phone / in person and
// need to enter them directly. This bypasses OTP but reuses the same capacity
// guard (confirmSlotsForBooking) so a manual CONFIRMED booking can't overbook a
// departure.

export interface ManualBookingInput {
  packageId: string;
  departureDateId?: string;
  /** ISO date — resolved to a departure of `packageId` starting that day. */
  departureDate?: string;
  groupSize: number;
  trekkerName: string;
  trekkerEmail: string;
  trekkerPhone: string;
  trekkerCountry?: string;
  trekkerId?: string;
  specialRequests?: string;
  addOns?: { addOnId: string; quantity: number }[];
  /** Optional guide to assign up front (validated against the agency's guides). */
  guideRef?: string | null;
  /** Explicit price override; otherwise computed from the package + add-ons. */
  totalPrice?: number;
  /** "INQUIRY" or "CONFIRMED" (default). CONFIRMED reserves the seats. */
  status?: string;
}

const bookingErr = (status: number, message: string) => {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
};

export async function createManualBooking(agencyId: string, input: ManualBookingInput) {
  const {
    packageId,
    groupSize,
    trekkerName,
    trekkerEmail,
    trekkerPhone,
  } = input;

  if (!packageId) throw bookingErr(400, "packageId is required");
  if (!trekkerName?.trim() || !trekkerEmail?.trim() || !trekkerPhone?.trim()) {
    throw bookingErr(400, "trekkerName, trekkerEmail and trekkerPhone are required");
  }
  const size = Number(groupSize);
  if (!Number.isInteger(size) || size < 1) throw bookingErr(400, "groupSize must be a positive integer");

  const wantStatus = String(input.status ?? "CONFIRMED").toUpperCase();
  if (!["INQUIRY", "CONFIRMED"].includes(wantStatus)) {
    throw bookingErr(400, "status must be INQUIRY or CONFIRMED");
  }

  // Package must belong to the calling agency.
  const pkg = await prisma.trekPackage.findFirst({
    where: { id: packageId, agencyId },
    select: { id: true, title: true, slug: true, pricePerPerson: true, volumeDiscounts: true, status: true },
  });
  if (!pkg) throw bookingErr(404, "Package not found");
  if (pkg.status !== "PUBLISHED") throw bookingErr(400, "Bookings can only be taken for a published package. Publish (or restore) it first.");

  // Resolve the departure — by id, or by ISO date against this package.
  let departure: Awaited<ReturnType<typeof prisma.trekDepartureDate.findUnique>> = null;
  if (input.departureDateId) {
    departure = await prisma.trekDepartureDate.findUnique({ where: { id: input.departureDateId } });
    if (!departure || departure.packageId !== packageId) throw bookingErr(400, "Invalid departure date for this package");
  } else if (input.departureDate) {
    const day = new Date(input.departureDate);
    if (Number.isNaN(day.getTime())) throw bookingErr(400, "Invalid departureDate");
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    departure = await prisma.trekDepartureDate.findFirst({
      where: { packageId, startDate: { gte: start, lt: end } },
    });
    if (!departure) throw bookingErr(400, "No departure date for this package on the given day");
  } else {
    throw bookingErr(400, "departureDateId or departureDate is required");
  }

  if (departure.startDate < new Date(new Date().setHours(0, 0, 0, 0))) throw bookingErr(400, "That departure date has already passed.");

  // Validate + price the add-ons (must belong to this package).
  let addOnRows: { id: string; price: unknown; perPerson: boolean }[] = [];
  const cleanAddOns = (input.addOns ?? []).filter((a) => a?.addOnId && Number(a.quantity) > 0);
  if (cleanAddOns.length) {
    const ids = cleanAddOns.map((a) => a.addOnId);
    addOnRows = await prisma.trekAddOn.findMany({ where: { id: { in: ids }, packageId } });
    if (addOnRows.length !== new Set(ids).size) throw bookingErr(400, "One or more add-ons are invalid for this package");
  }

  // Validate the guide up front if one was supplied.
  const guideRef = input.guideRef ? String(input.guideRef) : null;
  if (guideRef) {
    const guide = await prisma.guideProfile.findFirst({
      where: { agencyId, guideRef, isActive: true },
      select: { id: true },
    });
    if (!guide) throw bookingErr(400, "Guide not found for this agency");
  }
  if (guideRef) await assertGuideAssignable(agencyId, guideRef, departure.id);

  // Price: explicit override wins, else base + add-ons.
  const addOnTotal = addOnRows.reduce((sum, row) => {
    const line = cleanAddOns.find((a) => a.addOnId === row.id)!;
    const qty = Number(line.quantity);
    return sum + Number(row.price) * (row.perPerson ? size * qty : qty);
  }, 0);
  const computed = discountedPricePerPerson(Number(pkg.pricePerPerson), pkg.volumeDiscounts, size) * size + addOnTotal;
  const price =
    input.totalPrice !== undefined && input.totalPrice !== null && Number(input.totalPrice) >= 0
      ? Number(input.totalPrice)
      : computed;

  // `trekkerId` links the booking to a platform user, which then surfaces that
  // user's name/email/phone in this agency's customers list. It came straight
  // from the request body, so an agency could attach ANY trekker id it had seen
  // and read their contact details. Only accept it when it is the same person the
  // agency is booking for: the trekker's account email must match trekkerEmail.
  let linkedTrekkerId: string | null = null;
  if (input.trekkerId) {
    const linked = await prisma.trekker.findUnique({
      where: { id: input.trekkerId },
      select: { id: true, user: { select: { email: true } } },
    });
    if (!linked || linked.user.email.toLowerCase() !== trekkerEmail.trim().toLowerCase()) {
      throw bookingErr(400, "trekkerId does not match trekkerEmail");
    }
    linkedTrekkerId = linked.id;
  }

  const baseData = {
    agencyId,
    packageId,
    departureDateId: departure.id,
    trekkerId: linkedTrekkerId,
    groupSize: size,
    totalPrice: price,
    trekkerName: trekkerName.trim(),
    trekkerEmail: trekkerEmail.trim(),
    trekkerPhone: trekkerPhone.trim(),
    trekkerCountry: input.trekkerCountry ?? null,
    specialRequests: input.specialRequests ?? null,
    assignedGuideId: guideRef,
  };

  const bookingInclude = {
    package: { select: { title: true, slug: true, currency: true } },
    departureDate: { select: { startDate: true } },
    addOns: { include: { addOn: true } },
  } as const;

  const addOnCreate = (bookingId: string) =>
    cleanAddOns.map((a) => ({
      bookingId,
      addOnId: a.addOnId,
      quantity: Number(a.quantity),
      priceAtBooking: addOnRows.find((r) => r.id === a.addOnId)!.price as never,
    }));

  let bookingId: string;
  if (wantStatus === "CONFIRMED") {
    // Reserve the seats and create the booking atomically (re-checks capacity).
    bookingId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await confirmSlotsForBooking(tx, departure!.id, size);
      const created = await tx.booking.create({ data: { ...baseData, status: "CONFIRMED" }, select: { id: true } });
      if (cleanAddOns.length) await tx.bookingAddOn.createMany({ data: addOnCreate(created.id) });
      return created.id;
    });
  } else {
    // INQUIRY — no seat reservation, but still refuse an impossible group size.
    const available = departure.maxSlots - departure.bookedSlots;
    if (size > available) throw bookingErr(409, `Only ${available} slot(s) available for this departure`);
    bookingId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.booking.create({ data: { ...baseData, status: "INQUIRY" }, select: { id: true } });
      if (cleanAddOns.length) await tx.bookingAddOn.createMany({ data: addOnCreate(created.id) });
      return created.id;
    });
  }

  trackBooking(wantStatus);
  void trackEvent({
    agency_id: agencyId,
    event_type: wantStatus === "CONFIRMED" ? "BOOKING_CONFIRMED" : "INQUIRY_SUBMITTED",
    trekker_id: linkedTrekkerId,
    package_id: packageId,
    metadata: { booking_id: bookingId },
  });
  if (guideRef) await markGuideBusy(agencyId, guideRef);
  const booking = (await prisma.booking.findUnique({
    where: { id: bookingId },
    include: bookingInclude,
  }))!;

  return {
    id: booking.id,
    status: booking.status,
    packageId: booking.packageId,
    packageTitle: booking.package.title,
    departureDateId: booking.departureDateId,
    departureDate: booking.departureDate.startDate,
    groupSize: booking.groupSize,
    totalPrice: Number(booking.totalPrice),
    assignedGuideId: booking.assignedGuideId,
    trekker: {
      id: booking.trekkerId,
      name: booking.trekkerName,
      email: booking.trekkerEmail,
      phone: booking.trekkerPhone,
      country: booking.trekkerCountry,
    },
    specialRequests: booking.specialRequests,
    addOns: booking.addOns.map((a: { addOnId: string; quantity: number; priceAtBooking: unknown; addOn: { name: string } }) => ({
      addOnId: a.addOnId,
      name: a.addOn.name,
      quantity: a.quantity,
      price: Number(a.priceAtBooking),
    })),
    createdAt: booking.createdAt,
  };
}


// ── manual stage change (the clickable steps on the booking page) ───────────

const STAGES = ["INQUIRY", "PAYMENT_PENDING", "PAID", "CONFIRMED", "ACTIVE", "COMPLETED"] as const;
export type BookingStage = (typeof STAGES)[number];
const STAGE_LABEL: Record<BookingStage, string> = { INQUIRY: "Inquiry", PAYMENT_PENDING: "Payment", PAID: "Paid", CONFIRMED: "Confirmed", ACTIVE: "On trek", COMPLETED: "Completed" };

/**
 * Move a booking to any step of its journey (Inquiry → Payment → Paid → Confirmed → On trek → Completed), forwards or
 * back — for offline payments, corrections, walk-ins. Seats and the payment link follow the step:
 *  - every step after Inquiry holds the seats (checked against capacity when leaving Inquiry; released when going back to it);
 *  - "Payment" has a live 48 h payment link (a fresh one when coming back to it); later steps mark the link as paid;
 *  - "On trek" needs a guide.
 * Cancelled / rejected / date-proposed bookings have their own flows and can't be moved this way.
 */
export async function setBookingStage(bookingId: string, agencyId: string, target: unknown) {
  if (typeof target !== "string" || !(STAGES as readonly string[]).includes(target)) throw bookingErr(400, `stage must be one of: ${STAGES.join(", ")}`);
  const to = target as BookingStage;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { package: true, paymentLink: true } });
  if (!booking) throw bookingErr(404, "Booking not found");
  if (booking.agencyId !== agencyId) throw bookingErr(403, "Unauthorized");
  const from = booking.status as string;
  if (!(STAGES as readonly string[]).includes(from)) throw bookingErr(409, `This booking is ${from.toLowerCase().replace(/_/g, " ")}, so its step can't be changed here.`);
  if (from === to) return { bookingId, status: to, changed: false };
  if (to === "ACTIVE" && !booking.assignedGuideId) throw bookingErr(409, "Assign a guide before moving the booking to “On trek”.");

  // From Inquiry to Payment is the normal "accept": seats + payment link + the traveller's email.
  if (from === "INQUIRY" && to === "PAYMENT_PENDING") {
    const r = await acceptBooking(bookingId, agencyId);
    return { ...r, changed: true };
  }

  const holdsSeats = (st: string) => st !== "INQUIRY";
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (!holdsSeats(from) && holdsSeats(to)) await confirmSlotsForBooking(tx, booking.departureDateId, booking.groupSize);
    if (holdsSeats(from) && !holdsSeats(to)) await releaseSlotsForBooking(tx, booking.departureDateId, booking.groupSize);

    if (to === "INQUIRY") {
      await tx.paymentLink.deleteMany({ where: { bookingId } }); // so it can be accepted again later
    } else if (to === "PAYMENT_PENDING") {
      const link = { urlToken: randomBytes(32).toString("hex"), amount: booking.totalPrice, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), used: false };
      await tx.paymentLink.upsert({ where: { bookingId }, create: { bookingId, ...link }, update: link });
    } else if (booking.paymentLink && !booking.paymentLink.used) {
      await tx.paymentLink.update({ where: { bookingId }, data: { used: true } }); // paid (offline or otherwise)
    }
    await tx.booking.update({ where: { id: bookingId }, data: { status: to } });
  });

  if (booking.trekkerId) {
    await notifyTrekker(booking.trekkerId, {
      title: "Booking updated",
      body: `Your booking for ${booking.package.title} is now: ${STAGE_LABEL[to]}.`,
      data: { bookingId, type: "BOOKING_STAGE", link: `/bookings/${bookingId}` },
    }).catch(() => undefined);
  }
  if (to === "ACTIVE" && booking.assignedGuideId) await markGuideBusy(agencyId, booking.assignedGuideId);
  if (from === "ACTIVE" || to === "COMPLETED") await releaseIdleGuides(agencyId);
  trackBooking(to);
  return { bookingId, status: to, changed: true };
}
