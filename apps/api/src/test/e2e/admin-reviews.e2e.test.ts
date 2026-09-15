// ─────────────────────────────────────────────────────────────────────────────
// Admin review moderation — end-to-end (API-wide docs/test pass, Batch 4).
//
// Regression test for a real vulnerability: `/admin/reviews/flagged`,
// `/admin/reviews/:id/remove`, `/admin/reviews/:id/dismiss-flag` had no auth
// middleware and no in-controller check at all — mounted directly at `/` in
// app.ts, they never passed through `admin/index.ts`'s `requireAdmin` gate
// the way every other `/admin/*` route does. Anyone could remove any review
// or dismiss a moderation flag with zero credentials. Fixed by adding
// `requireAdmin` to all three.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };

/** A real Review row, satisfying its FK chain (Booking, unique per review; Trekker). */
async function seedReview(ctx: E2EContext) {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const seed = await seedPackage(ctx.agencyId);

  const user = await db.user.create({
    data: { email: `reviewer-${s}@example.com`, passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
    select: { id: true },
  });
  const trekker = await db.trekker.create({ data: { userId: user.id, fullName: "Jamie Reviewer" }, select: { id: true } });

  const booking = await db.booking.create({
    data: {
      agencyId: ctx.agencyId,
      trekkerId: trekker.id,
      packageId: seed.packageId,
      departureDateId: seed.departureDateId,
      groupSize: 1,
      totalPrice: 500,
      trekkerName: "Jamie Reviewer",
      trekkerEmail: `reviewer-${s}@example.com`,
      trekkerPhone: "+9779800000099",
      status: "COMPLETED",
    },
    select: { id: true },
  });

  const review = await db.review.create({
    data: { bookingId: booking.id, trekkerId: trekker.id, agencyId: ctx.agencyId, rating: 5, text: "Great trip!" },
    select: { id: true },
  });

  return { reviewId: review.id, userId: user.id, trekkerId: trekker.id, bookingId: booking.id };
}

d("Admin review moderation (e2e)", () => {
  let ctx: E2EContext;

  afterAll(async () => {
    if (ctx) {
      await db.review.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await ctx.cleanup();
    }
  });

  it("is not reachable without the admin context (the vulnerability this test guards)", async () => {
    expect((await request(app).get("/admin/reviews/flagged")).status).not.toBe(200);
    expect((await request(app).patch("/admin/reviews/some-id/remove")).status).not.toBe(200);
    expect((await request(app).patch("/admin/reviews/some-id/dismiss-flag")).status).not.toBe(200);
  });

  it("GET /admin/reviews/flagged is reachable with the admin context", async () => {
    const res = await request(app).get("/admin/reviews/flagged").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("PATCH /admin/reviews/:id/remove removes a real review as a content violation", async () => {
    ctx = await createAgencyContext();
    const { reviewId } = await seedReview(ctx);

    const res = await request(app).patch(`/admin/reviews/${reviewId}/remove`).set(adminHeaders);
    expect(res.status).toBe(200);

    const gone = await db.review.findUnique({ where: { id: reviewId } });
    expect(gone).toBeNull();
  });

  it("PATCH /admin/reviews/:id/dismiss-flag dismisses a PENDING flag on a review", async () => {
    if (!ctx) ctx = await createAgencyContext();
    const { reviewId } = await seedReview(ctx);
    const flag = await db.reviewFlag.create({
      data: { reviewId, reason: "Inappropriate content", flaggedBy: "some-agency-user-id" },
      select: { id: true },
    });

    const res = await request(app).patch(`/admin/reviews/${reviewId}/dismiss-flag`).set(adminHeaders);
    expect(res.status).toBe(200);

    const updated = await db.reviewFlag.findUnique({ where: { id: flag.id } });
    expect(updated?.status).not.toBe("PENDING");
  });
});
