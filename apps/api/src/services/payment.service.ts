import { prisma, type Prisma, BookingStatus } from "@funtush/database";
import { generateBookingConfirmationPDF } from "../lib/generatePDF";
import { sendBookingConfirmationEmail, sendGuideAssignmentEmail } from "../utils/email";
import { notifyAgencyAdmins, notifyTrekker } from "./notification.service";
import { releaseSlotsForBooking } from "./departureDate.service";
import { trackBooking, recordRevenue } from "./prometheusMetrics";
import { trackEvent } from "./analytics.service";
import { httpError } from "../utils/httpError";

export async function processConfirmedPayment(
  bookingId: string,
  agencyId: string,
  amountPaid: number,
  currency = "unknown",
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

  //  gateways retry webhooks.
  if (booking.paymentLink?.used) return;

  // Only PAYMENT_PENDING bookings can be marked paid — blocks a late/duplicate
  // webhook from overwriting a booking that moved on (CONFIRMED) or died (CANCELLED).
  if (booking.status !== BookingStatus.PAYMENT_PENDING) {
    throw new Error(`Booking ${bookingId} is not awaiting payment`);
  }

  // Reconcile gateway amount against what we actually billed.
  const expectedAmount = Number(booking.totalPrice);
  if (Math.abs(amountPaid - expectedAmount) > 0.01) {
    throw new Error(
      `Amount mismatch: expected ${expectedAmount}, received ${amountPaid}`
    );
  }

  // Guide auto-assignment — stub until the Guide model exists.
  // const guide = await prisma.guide.findFirst({ where: { agencyId, isAutoAssign: true, isAvailable: true } });
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

  // Counted here — after the commit, and after the `paymentLink.used` early
  // return above — so a gateway retrying the same webhook can't double-count.
  trackBooking("PAID");
  recordRevenue(currency, amountPaid);
  void trackEvent({
    agency_id: agencyId,
    event_type: "BOOKING_PAID",
    trekker_id: booking.trekkerId,
    package_id: booking.packageId,
    metadata: { booking_id: bookingId, amount: amountPaid, currency },
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
  
// inform the agency payment is done — agency need to call confirmBooking.
  await notifyAgencyAdmins(agencyId, {
    title: "Payment Received",
    body: `Payment received for ${booking.package.title}. Please confirm the booking.`,
    data: { bookingId, type: "PAYMENT_RECEIVED", link: `/dashboard/bookings/${bookingId}` },
  });
}

// Releases slots + cancels bookings whose 48h payment window expired unpaid.
// Called on a schedule (see jobs/expireUnpaidBookings.job.ts).
export async function expireUnpaidBookings() {
  // Keyset-paged, and filtered to bookings still awaiting payment *in SQL*.
  // This used to load every expired link at once — including those whose
  // booking had already moved on (paid, cancelled), which never become
  // `used`, so the scan grew forever and held all of it in memory.
  const BATCH = 200;
  let lastId: string | undefined;

  for (;;) {
    const links = await prisma.paymentLink.findMany({
      where: {
        used: false,
        expiresAt: { lt: new Date() },
        booking: { status: "PAYMENT_PENDING" },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      include: { booking: true },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (links.length === 0) break;
    const nextId = links[links.length - 1].id;
    // Progress guard: if the cursor didn't advance we'd loop on the same page
    // forever (e.g. a query layer that ignores the `id > lastId` filter).
    if (lastId !== undefined && nextId <= lastId) break;
    lastId = nextId;

    for (const link of links) {
      // The query already filters on this, but the booking can change between
      // the read and now (a late payment lands): re-check before cancelling.
      if (link.booking.status !== "PAYMENT_PENDING") continue;
      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await releaseSlotsForBooking(tx, link.booking.departureDateId, link.booking.groupSize);
          await tx.booking.update({
            where: { id: link.bookingId },
            data: { status: "CANCELLED", rejectionReason: "Payment window expired" },
          });
        });

        if (link.booking.trekkerId) {
          await notifyTrekker(link.booking.trekkerId, {
            title: "Booking Expired",
            body: "Your payment window expired and the booking was cancelled.",
            data: { bookingId: link.bookingId, type: "BOOKING_EXPIRED", link: `/bookings/${link.bookingId}` },
          });
        }
      } catch (err) {
        // one bad booking must not stop the rest of the sweep
        console.error(`[expireUnpaidBookings] failed for booking ${link.bookingId}:`, err);
      }
    }
  }
}


/**
 * Bind a gateway transaction id to the booking it pays for — once.
 *
 * Khalti's callback carries `pidx` plus a `purchase_order_id` (the booking) that
 * the *sender* chooses, and Khalti's lookup only says "this pidx is Completed for
 * NPR X". Nothing tied the payment to the booking, so one genuine payment could be
 * replayed at /webhooks/payment/:agency/khalti naming every booking priced at X.
 *
 * The first claim wins. Re-delivery for the SAME booking (gateways retry) is
 * fine; the same transaction naming a DIFFERENT booking is rejected.
 */
export async function claimGatewayTransaction(gateway: string, transactionId: string, bookingId: string): Promise<void> {
  try {
    await prisma.gatewayTransaction.create({ data: { gateway, transactionId, bookingId } });
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const existing = await prisma.gatewayTransaction.findUnique({
      where: { gateway_transactionId: { gateway, transactionId } },
      select: { bookingId: true },
    });
    if (existing?.bookingId !== bookingId) {
      throw httpError(409, "This payment has already been applied to a different booking");
    }
  }
}
