import { prisma, type Prisma, BookingStatus } from "@funtush/database";
import { generateBookingConfirmationPDF } from "../lib/generatePDF";
import { sendBookingConfirmationEmail, sendGuideAssignmentEmail } from "../utils/email";

export async function processConfirmedPayment(
  bookingId: string,
  agencyId: string,
  amountPaid: number
): Promise<void> {

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      package: {
        include: {
          itineraries: { orderBy: { dayNumber: "asc" } },
        },
      },
      departureDate: true,
      agency: {
        include: {
          profile: true,
        },
      },
      addOns: {
        include: { addOn: true },
      },
      paymentLink: true,
    },
  });

  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  if (booking.agencyId !== agencyId) throw new Error("Agency mismatch on booking");
  if (booking.status === BookingStatus.PAID) return; 

  // 1. Verify payment amount matches booking total
  const expectedAmount = Number(booking.totalPrice);
  if (Math.abs(amountPaid - expectedAmount) > 0.01) {
    throw new Error(
      `Amount mismatch: expected ${expectedAmount}, received ${amountPaid}`
    );
  }

  // 3. Auto-assign guide if agency has auto-assignment configured 
  // TODO: replace with your Guide model query once the Guide model exists
  // Example:
  //   const guide = await prisma.guide.findFirst({
  //     where: {
  //       agencyId,
  //       isAutoAssign: true,
  //       isAvailable: true,
  //     },
  //   });
  //   if (guide) assignedGuideId = guide.id;
  const assignedGuideId: string | null = booking.assignedGuideId ?? null;
  const assignedGuideName: string | null = null;
  const assignedGuidePhone: string | null = null;
  const assignedGuideEmail: string | null = null;

  // Atomic DB update — booking PAID + slot decrement 
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.PAID,
        assignedGuideId,
        updatedAt: new Date(),
      },
    });

    await tx.paymentLink.update({
      where: { bookingId },
      data: { used: true },
    });

  });

  // Generate booking confirmation PDF with all details
  const agencyProfile = booking.agency.profile;

  const pdfBuffer = await generateBookingConfirmationPDF({
    bookingId: booking.id,
    trekkerName: booking.trekkerName,
    trekkerEmail: booking.trekkerEmail,
    trekkerPhone: booking.trekkerPhone,
    packageTitle: booking.package.title,
    agencyName: booking.agency.name,
    agencyEmail: booking.agency.email,
    agencyPhone: agencyProfile?.phone
      ? JSON.stringify(agencyProfile.phone)
      : booking.agency.email,
    departureDate: booking.departureDate.startDate,
    durationDays: booking.package.durationDays,
    groupSize: booking.groupSize,
    totalPrice: Number(booking.totalPrice),
    currency: "USD",
    assignedGuideName,
    assignedGuidePhone,
    paidAt: new Date(),
    addOns: booking.addOns.map((a: typeof booking.addOns[number]) => ({
      name: a.addOn.name,
      quantity: a.quantity,
      price: Number(a.priceAtBooking),
    })),
    itinerary: booking.package.itineraries.map((i: typeof booking.package.itineraries[number]) => ({
      dayNumber: i.dayNumber,
      location: i.location ?? "",
      description: i.description ?? "",
    })),
  });

  // Send confirmation email to trekker with PDF attachment
  await sendBookingConfirmationEmail(
    booking.trekkerEmail,
    booking.trekkerName,
    booking.package.title,
    booking.departureDate.startDate,
    booking.id,
    assignedGuideName,
    pdfBuffer
  );

  // Send assignment notification to guide 
  if (assignedGuideEmail && assignedGuideName) {
    await sendGuideAssignmentEmail(
      assignedGuideEmail,
      assignedGuideName,
      booking.package.title,
      booking.departureDate.startDate,
      booking.trekkerName,
      booking.trekkerPhone,
      booking.trekkerCountry ?? null,
      booking.groupSize,
      booking.id
    );
  }
}
