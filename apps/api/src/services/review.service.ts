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
            agency: {
                select:{
                    name: true,
                    slug: true,
                }
            }
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
            `http://funtush.com/${booking.agency.slug}review?token=${token}`;
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


export const getAgencyReview = async (slug: string) => {

    const agency = await db.agency.findUnique({
        where: {
            slug,
        },
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    const reviews = await db.review.findMany({
        where: {
            agencyId: agency.id,
        },
        include: {
            trekker: {
                select: {
                    fullName: true,
                },
            },
            response: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    const aggregate = await db.review.aggregate({
        _avg: { rating: true },
        _count: { rating: true },
        where: { agencyId: agency.id },
    });

    // declaring empty stars - for count
    const distribution: Record<number, number> = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
    };

    //grouped by count of each ratings i.e. if two '5' ratings, then 5 : 2
    reviews.forEach((review) => {
        if (review.rating >= 1 && review.rating <= 5) {
            distribution[review.rating]++;  //placing rating in place to their value
        }
    });

    const starDistribution = Object.entries(distribution).reduce(
        (acc, [star, count]) => {    // ("acc:final object", ["star:eg.1,2,3]","count:no. of reviews for that star")
            acc[star] = reviews.length
                ? Number(((count / reviews.length) * 100).toFixed(1))
                : 0;

            return acc;
        },
        {} as Record<string, number>
    );

    return {
        averageRating: Number((aggregate._avg.rating || 0).toFixed(1)),
        totalReviews: aggregate._count.rating,
        starDistribution,
        reviews,
    };
};


export const respondToReviewService = async (
    agencyUserId: string,
    reviewId: string,
    responseText: string
) => {
    const review = await db.review.findFirst({
        where: {
            id: reviewId,
            // agencyId: agencyId,
        },
        include: {
            response: true,
        },
    });

    if (!review) {
        throw new Error("Review not found");
    }

    if (review.response) {
        throw new Error("Already responded");
    }

    return db.reviewResponse.create({
        data: {
            reviewId,
            agencyUserId, 
            responseText,
        },
    });
};



export const flagReviewService = async (
    agencyUserId: string,
    reviewId: string,
    reason: string
) => {
    const review = await db.review.findFirst({
        where: {
            id: reviewId,
        },
    });

    if (!review) {
        throw new Error("Review not found");
    }

    // if (review?.agencyId !== agencyUserId.a) {
    //     throw new Error("Not allowed to flag this review");
    // }


    const existingFlag = await db.reviewFlag.findFirst({
        where: {
            reviewId,
            flaggedBy: agencyUserId,
        },
    });

    if (existingFlag) {
        throw new Error("You already flagged this review");
    }

    return db.reviewFlag.create({
        data: {
            reviewId,
            reason,
            flaggedBy: agencyUserId,
        },
    });
};

export const getFlaggedAgencyService = async () => {
  const flaggedReviews = await db.reviewFlag.findMany({
    include: {
      review: {
        include: {
          trekker: {
            select: {
              fullName: true,
            },
          },
          agency: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return {
    flaggedReviews
  }
}

export const removeReviewWithContentViolation = async (reviewId: string) => {

  const review = await db.review.findUnique({
    where: {
      id: reviewId,
    },
  });

  if (!review) {
    throw new Error("Review not found");
  }

  await db.review.delete({
    where: {
      id: reviewId,
    },
  });

  return {
    message: "Review removed successfully",
  };

};


export const dismissFlagService = async (reviewId: string) => {

  const review = await db.review.findUnique({
    where: {
      id: reviewId,
    },
  });

  if (!review) {
    throw new Error("Review not found");
  }

  await db.reviewFlag.updateMany({
    where: {
      reviewId,
      status: "PENDING",
    },
    data: {
      status: "DISMISSED"
    },
  });

  return {
    message: "Flag dismissed. Review remains published.",
  };

}