// Reviews — title field integration test (backend catch-up pass). Real DB,
// skip if down. Reviews had zero test coverage before this — this closes that
// gap for the new `title` field specifically, on the real create-review path
// (token redemption → review row), not just a schema check.
import crypto from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/review.service");

let DB_AVAILABLE = false;
let db: Database["db"];
let svc: Svc;
let tierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;
  const tier = await db.subscriptionTier.upsert({
    where: { name: "REVIEW_TEST_TIER" },
    update: {},
    create: { name: "REVIEW_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/review.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[review.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

let agencyId = "";
let agencySlug = "";
let trekkerId = "";
let userId = "";
const bookingIds: string[] = [];
const packageIds: string[] = [];

d("Review title (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    agencySlug = `review-${s}`;

    const agency = await db.agency.create({
      data: { name: `Review ${s}`, email: `review-${s}@example.com`, slug: agencySlug, tierId },
      select: { id: true },
    });
    agencyId = agency.id;

    const user = await db.user.create({
      data: { email: `review-trek-${s}@example.com`, passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
      select: { id: true },
    });
    userId = user.id;

    const trekker = await db.trekker.create({
      data: { userId, fullName: "Review Trekker" },
      select: { id: true },
    });
    trekkerId = trekker.id;
  });

  afterAll(async () => {
    if (bookingIds.length) {
      await db.review.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {});
      await db.reviewInvitation.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {});
      await db.booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {});
    }
    // `TrekDepartureDate` cascades from `TrekPackage`, so deleting the
    // packages is enough to clean up both.
    if (packageIds.length) {
      await db.trekPackage.deleteMany({ where: { id: { in: packageIds } } }).catch(() => {});
    }
    if (trekkerId) await db.trekker.delete({ where: { id: trekkerId } }).catch(() => {});
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => {});
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
  });

  /**
   * `Review.bookingId` and `ReviewInvitation.bookingId` are both `@unique` —
   * one booking gets at most one invitation and at most one review, ever. So
   * every test that actually creates a review needs its own fresh completed
   * booking, not a shared fixture — this is the per-test equivalent of the
   * shared agency/trekker set up once in `beforeAll`.
   */
  async function issueInvitationForFreshBooking(): Promise<string> {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const pkg = await db.trekPackage.create({
      data: {
        agencyId,
        title: `Pkg ${s}`,
        slug: `pkg-review-${s}`,
        durationDays: 10,
        pricePerPerson: 1200,
        maxGroupSize: 12,
        difficulty: "MODERATE",
        status: "PUBLISHED",
      },
      select: { id: true },
    });
    packageIds.push(pkg.id);

    const dep = await db.trekDepartureDate.create({
      data: { packageId: pkg.id, startDate: new Date("2026-06-01"), maxSlots: 10, bookedSlots: 0 },
      select: { id: true },
    });

    const booking = await db.booking.create({
      data: {
        agencyId,
        trekkerId,
        packageId: pkg.id,
        departureDateId: dep.id,
        status: "COMPLETED",
        groupSize: 1,
        totalPrice: 1200,
        trekkerName: "Review Trekker",
        trekkerEmail: "review-trek@example.com",
        trekkerPhone: "+1 555 0100",
      },
      select: { id: true },
    });
    bookingIds.push(booking.id);

    const token = crypto.randomBytes(16).toString("hex");
    await db.reviewInvitation.create({
      data: { bookingId: booking.id, token, expiresAt: new Date(Date.now() + 60_000) },
    });
    return token;
  }

  it("saves a title alongside the review, and it survives the round trip", async () => {
    const token = await issueInvitationForFreshBooking();

    const review = await svc.createReviewService(
      token,
      5,
      "Absolutely stunning trek, highly recommend.",
      [],
      "Best trek of my life",
    );

    expect(review.title).toBe("Best trek of my life");

    const reread = await db.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(reread.title).toBe("Best trek of my life");
  });

  it("leaves title null when the reviewer doesn't give one", async () => {
    const token = await issueInvitationForFreshBooking();

    const review = await svc.createReviewService(token, 4, "Good trip overall.", []);
    expect(review.title).toBeNull();
  });

  it("treats a blank/whitespace title the same as no title", async () => {
    const token = await issueInvitationForFreshBooking();

    const review = await svc.createReviewService(token, 3, "It was fine.", [], "   ");
    expect(review.title).toBeNull();
  });

  it("a review with a title still shows up in the agency's public review list", async () => {
    const token = await issueInvitationForFreshBooking();
    const created = await svc.createReviewService(token, 5, "Loved it.", [], "Unreal views");

    const { reviews } = await svc.getAgencyReview(agencySlug);
    expect(reviews.find((r) => r.id === created.id)?.title).toBe("Unreal views");
  });
});
