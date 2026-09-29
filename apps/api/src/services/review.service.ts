import crypto from "crypto";
import { db } from "@funtush/database";
import { sendReviewInvitationEmail } from "../utils/email";

export const sendReviewInvitations = async () => {
    // Completed bookings with no review AND no invitation yet, fetched a page at
    // a time. The "no invitation yet" test is part of the query — it used to be a
    // separate findUnique per booking (N+1) after loading every completed
    // booking of every agency into memory.
    const BATCH = 200;
    let lastId: string | undefined;

    for (;;) {
        const bookings = await db.booking.findMany({
            where: {
                status: "COMPLETED",
                review: null,
                reviewInvitation: null,
                ...(lastId ? { id: { gt: lastId } } : {}),
            },
            select: {
                id: true,
                trekkerEmail: true,
                trekkerName: true,
                agency: { select: { slug: true } },
            },
            orderBy: { id: "asc" },
            take: BATCH,
        });
        if (bookings.length === 0) break;
        const nextId = bookings[bookings.length - 1].id;
        // Progress guard: never loop on the same page if the cursor didn't advance.
        if (lastId !== undefined && nextId <= lastId) break;
        lastId = nextId;

        for (const booking of bookings) {
            const token = crypto.randomBytes(32).toString("hex");

            try {
                // the invitation row is created first, so the booking drops out of
                // the query above and a failed email never causes a duplicate send loop
                await db.reviewInvitation.create({
                    data: {
                        bookingId: booking.id,
                        token,
                        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    },
                });
            } catch (err) {
                // unique(bookingId): another run/process got there first
                if ((err as { code?: string })?.code === "P2002") continue;
                throw err;
            }

            // The trekker-facing app hosts the review form (funtush-frontend /review); REVIEW_PAGE_URL overrides it.
            const reviewBase = process.env.REVIEW_PAGE_URL ?? `${process.env.TREKKER_APP_URL ?? "http://localhost:3001"}/review`;
            const invitationLink = `${reviewBase}?token=${encodeURIComponent(token)}`;
            await sendReviewInvitationEmail(booking.trekkerEmail, booking.trekkerName, invitationLink);
        }
    }
};


const reviewErr = (message: string) => Object.assign(new Error(message), { status: 400 });

/** Public form: check the shape of what we're given before anything is stored. */
export function validateReviewInput(rating: unknown, text: unknown, title?: unknown) {
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw reviewErr("Rating must be a whole number from 1 to 5.");
    }
    if (typeof text !== "string" || text.trim().length < 3 || text.trim().length > 2000) {
        throw reviewErr("Please write 3-2000 characters about your trek.");
    }
    if (title !== undefined && title !== null && title !== "") {
        if (typeof title !== "string" || title.trim().length > 100) throw reviewErr("The headline must be at most 100 characters.");
    }
}

/**
 * Checks a review invitation token WITHOUT consuming it. Run before any photo is uploaded so an invalid or
 * used token can't be used to fill the storage bucket. Same errors as createReviewService.
 */
export async function assertReviewTokenUsable(token: string) {
    const invitation = await db.reviewInvitation.findUnique({ where: { token }, include: { booking: { select: { status: true } } } });
    if (!invitation) throw new Error("Invalid token");
    if (invitation.used) throw new Error("Token already used");
    if (invitation.expiresAt < new Date()) throw new Error("Token expired");
    if (invitation.booking.status !== "COMPLETED") throw new Error("Booking not completed");
}

export const createReviewService = async (
    token: string,
    rating: number,
    text: string,
    photos: string[],
    title?: string
) => {
    validateReviewInput(rating, text, title);
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
                title: title?.trim() || undefined,
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


export interface ReviewFilters {
    /** Only reviews with this star rating (1-5). */
    rating?: number;
    /** true = the agency has responded, false = still waiting. */
    responded?: boolean;
    sort?: "newest" | "oldest" | "lowest" | "highest";
}

export const getAgencyReview = async (
    slug: string,
    pagination: { page: number; limit: number } = { page: 1, limit: 20 },
    filters: ReviewFilters = {},
) => {
    const { page, limit } = pagination;

    const agency = await db.agency.findUnique({
        where: {
            slug,
        },
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    // The list is paginated, but the summary (average, total, star split) must
    // still describe *every* review — so it's computed in the database with
    // aggregate/groupBy rather than derived from whichever page was fetched.
    const listWhere = {
        agencyId: agency.id,
        ...(filters.rating ? { rating: filters.rating } : {}),
        ...(filters.responded === true ? { response: { isNot: null } } : filters.responded === false ? { response: { is: null } } : {}),
    };
    const orderBy =
        filters.sort === "oldest" ? [{ createdAt: "asc" as const }, { id: "asc" as const }]
        : filters.sort === "lowest" ? [{ rating: "asc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }]
        : filters.sort === "highest" ? [{ rating: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }]
        : [{ createdAt: "desc" as const }, { id: "desc" as const }];

    // Six full calendar months back (inclusive of the current month) — the trend chart.
    const now = new Date();
    const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    const [reviews, aggregate, ratingGroups, filteredTotal, respondedCount, trendRows] = await Promise.all([
        db.review.findMany({
            where: listWhere,
            include: {
                trekker: {
                    select: {
                        fullName: true,
                    },
                },
                response: true,
                booking: { select: { package: { select: { id: true, title: true } } } },
            },
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
        }),
        db.review.aggregate({
            _avg: { rating: true },
            _count: { rating: true },
            where: { agencyId: agency.id },
        }),
        db.review.groupBy({
            by: ["rating"],
            _count: { rating: true },
            where: { agencyId: agency.id },
        }),
        db.review.count({ where: listWhere }),
        db.review.count({ where: { agencyId: agency.id, response: { isNot: null } } }),
        db.review.findMany({
            where: { agencyId: agency.id, createdAt: { gte: trendStart } },
            select: { rating: true, createdAt: true },
        }),
    ]);

    const totalReviews = aggregate._count.rating;

    // percentage AND raw count of all reviews at each star value (1-5), 0 when there are none
    const starDistribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    const starCounts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const group of ratingGroups) {
        if (group.rating >= 1 && group.rating <= 5) {
            starCounts[String(group.rating)] = group._count.rating;
            if (totalReviews > 0) {
                starDistribution[String(group.rating)] = Number(
                    ((group._count.rating / totalReviews) * 100).toFixed(1),
                );
            }
        }
    }

    // Average rating per month, trailing 6 months. A month with no reviews gets
    // averageRating: null (not a fabricated carry-forward) so the chart shows a
    // real gap instead of pretending the rating held steady.
    const monthBuckets = new Map<string, { sum: number; count: number }>();
    for (let i = 0; i < 6; i++) {
        const d = new Date(Date.UTC(trendStart.getUTCFullYear(), trendStart.getUTCMonth() + i, 1));
        monthBuckets.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, { sum: 0, count: 0 });
    }
    for (const r of trendRows) {
        const key = `${r.createdAt.getUTCFullYear()}-${String(r.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
        const bucket = monthBuckets.get(key);
        if (bucket) {
            bucket.sum += r.rating;
            bucket.count += 1;
        }
    }
    const monthlyTrend = [...monthBuckets.entries()].map(([month, b]) => ({
        month,
        averageRating: b.count > 0 ? Number((b.sum / b.count).toFixed(1)) : null,
        count: b.count,
    }));

    return {
        averageRating: Number((aggregate._avg.rating || 0).toFixed(1)),
        totalReviews,
        /** How many of ALL the agency's reviews have an agency response (for the response rate). */
        respondedCount,
        starDistribution,
        starCounts,
        monthlyTrend,
        reviews,
        page,
        limit,
        /** Matches the filters; equals totalReviews when none are applied. */
        filteredTotal,
        pages: Math.ceil(filteredTotal / limit),
    };
};


/**
 * The agency a staff/admin session belongs to. Review actions must be limited to
 * reviews *about that agency* — the two handlers below used to look a review up
 * by id alone, so any agency could post the "official response" on (or flag) a
 * competitor's review.
 */
async function agencyIdOfUser(agencyUserId: string): Promise<string> {
    const au = await db.agencyUser.findUnique({ where: { id: agencyUserId }, select: { agencyId: true } });
    if (!au) throw new Error("Agency user not found");
    return au.agencyId;
}

export const respondToReviewService = async (
    agencyUserId: string,
    reviewId: string,
    responseText: string
) => {
    const agencyId = await agencyIdOfUser(agencyUserId);
    // 404, not 403: don't reveal that a review with this id exists at another agency
    const review = await db.review.findFirst({
        where: { id: reviewId, agencyId },
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



/** The agency's own delete — distinct from removeReviewWithContentViolation (admin, any review, content-violation path). */
export const deleteAgencyReviewService = async (
    agencyUserId: string,
    reviewId: string
) => {
    const agencyId = await agencyIdOfUser(agencyUserId);
    // 404, not 403: don't reveal that a review with this id exists at another agency
    const review = await db.review.findFirst({ where: { id: reviewId, agencyId } });
    if (!review) {
        throw new Error("Review not found");
    }
    await db.review.delete({ where: { id: reviewId } });
    return { message: "Review deleted successfully" };
};

export const flagReviewService = async (
    agencyUserId: string,
    reviewId: string,
    reason: string
) => {
    const agencyId = await agencyIdOfUser(agencyUserId);
    const review = await db.review.findFirst({
        where: { id: reviewId, agencyId },
    });

    if (!review) {
        throw new Error("Review not found");
    }


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

/** Moderation works the PENDING queue; dismissed flags are history and are only returned when asked for. */
export type FlagFilter = { status?: "PENDING" | "DISMISSED" };

export const countFlaggedReviews = (filter: FlagFilter = { status: "PENDING" }) =>
  db.reviewFlag.count({ where: filter.status ? { status: filter.status } : {} });

export const getFlaggedAgencyService = async (
  page?: { skip: number; take: number },
  filter: FlagFilter = { status: "PENDING" },
) => {
  const flaggedReviews = await db.reviewFlag.findMany({
    where: filter.status ? { status: filter.status } : {},
    ...(page ?? {}),
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
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
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