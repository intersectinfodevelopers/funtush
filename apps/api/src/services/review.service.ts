import crypto from "crypto";
import { db } from "@funtush/database";
import { sendReviewInvitationEmail } from "src/utils/email";

export const sendReviewInvitations = async () => {

  const completedBookings = await db.booking.findMany({
    where: {
      status: "COMPLETED",
      review: null,
    },
    include: {
      trekker: {
        include: {
          user: true,
        },
      },
    },
  });

  for (const booking of completedBookings) {
    const existing = await db.reviewInvitation.findUnique({
      where: {
        bookingId: booking.id,
      },
    });

    if (existing) continue;

    const token = crypto.randomBytes(32).toString("hex");

    await db.reviewInvitation.create({
      data: {
        bookingId: booking.id,
        token,
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ),
      },
    });

    const invitationLink =
      `http://funtush.com/review?token=${token}`;
    //   `${process.env.FRONTEND_URL}/review?token=${token}`;

    await sendReviewInvitationEmail(
      booking.trekkerEmail,
      booking.trekkerName,
      invitationLink
    );
  }
};


export const createReviewService = async (
  token: string,
  rating: number,
  text: string,
  photos: string[]
) => {
  const invitation =
    await db.reviewInvitation.findUnique({
      where: { token },
      include: {
        booking: true,
      },
    });

  if (!invitation)
    throw new Error("Invalid token");

  if (invitation.used)
    throw new Error("Token already used");

  if (invitation.expiresAt < new Date())
    throw new Error("Token expired");

  if (invitation.booking.status !== "COMPLETED")
    throw new Error("Booking not completed");

  const review = await db.$transaction(async (tx) => {
    const createdReview = await tx.review.create({
      data: {
        bookingId: invitation.booking.id,
        trekkerId: invitation.booking.trekkerId!,
        agencyId: invitation.booking.agencyId,

        rating,
        text,
        photos,

        verified: true,
      },
    });

    await tx.reviewInvitation.update({
      where: {
        id: invitation.id,
      },
      data: {
        used: true,
      },
    });

    return createdReview;
  });

  return review;
};