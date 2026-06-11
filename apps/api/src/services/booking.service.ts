import { prisma, redis } from "@funtush/database";
import { generateOTP } from "@funtush/auth";
import { sendOtpEmail } from "../utils/email.js";
import { sendInquiryConfirmationEmail, sendAgencyInquiryAlertEmail } from "../utils/email.js";

//Types

export interface InquiryInput {
  packageId:       string;
  departureDateId: string;
  groupSize:       number;
  addOns?:         { addOnId: string; quantity: number }[];
  trekkerName:     string;
  trekkerEmail:    string;
  trekkerPhone:    string;
  trekkerCountry?: string;
  specialRequests?: string;
}

// Redis key helpers
const otpKey   = (token: string) => `inquiry:otp:${token}`;
const dataKey  = (token: string) => `inquiry:data:${token}`;
const TTL      = 15 * 60; // 15 minutes

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
  const addOnTotal = addOnsWithPrice.reduce((sum, addOn) => {
    const line = input.addOns!.find((a) => a.addOnId === addOn.id)!;
    const qty  = line.quantity;
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
      agencyId:        data.agencyId,
      packageId:       data.packageId,
      departureDateId: data.departureDateId,
      groupSize:       data.groupSize,
      totalPrice:      data.totalPrice,
      status:          "INQUIRY",
      trekkerName:     data.trekkerName,
      trekkerEmail:    data.trekkerEmail,
      trekkerPhone:    data.trekkerPhone,
      trekkerCountry:  data.trekkerCountry,
      specialRequests: data.specialRequests,
      // addOns saved separately below
    },
    include: {
      package: { include: { agency: true } },
      departureDate: true,
    },
  });

  // Save add-ons snapshot
  if (data.addOns?.length) {
    const addOns = await prisma.trekAddOn.findMany({
      where: { id: { in: data.addOns.map((a) => a.addOnId) } },
    });

    await prisma.bookingAddOn.createMany({
      data: data.addOns.map((a) => {
        const addOn = addOns.find((x) => x.id === a.addOnId)!;
        return {
          bookingId:      booking.id,
          addOnId:        a.addOnId,
          quantity:       a.quantity,
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

  return {
    bookingId: booking.id,
    status:    "INQUIRY",
    message:   "Your inquiry has been submitted. The agency will confirm within 24 hours.",
  };
}

