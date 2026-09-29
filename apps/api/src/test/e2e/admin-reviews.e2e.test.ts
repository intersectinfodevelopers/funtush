// ─────────────────────────────────────────────────────────────────────────────
// Admin review moderation — end-to-end (API-wide docs/test pass, Batch 4).
//
// Regression test for a real vulnerability: `/admin/reviews/flagged`,
// `/admin/reviews/:id/remove`, `/admin/reviews/:id/dismiss-flag` had no auth
// middleware and no in-controller check at all — mounted directly at `/` in
// app.ts, they never passed through `admin/index.ts`'s `requireAdmin` gate
// the way every other `/admin/*` route does. Anyone could remove any review
// or dismiss a moderation flag with zero credentials. First fixed by adding
// `requireAdmin` (IP allow-list) to all three — but that proves WHERE a
// request came from, not WHO sent it, and is dev-bypassable via
// SKIP_ADMIN_IP_CHECK. Now also requires `requireAuth` + `requireSuperAdminRole`,
// matching every other admin route in routes/admin/*.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { normalizeEmail } from "@funtush/shared";
import { generateAccessToken } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const adminHeaders = {
  Host: "admin.funtush.com",
  "X-Forwarded-For": "127.0.0.1",
  Authorization: `Bearer ${generateAccessToken({ userId: "e2e-platform-admin", roleType: "PLATFORM", role: "SUPER_ADMIN" } as Parameters<typeof generateAccessToken>[0])}`,
};

/** A real Review row, satisfying its FK chain (Booking, unique per review; Trekker). */
async function seedReview(ctx: E2EContext) {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const seed = await seedPackage(ctx.agencyId);

  const reviewerEmail = `reviewer-${s}@example.com`;
  const user = await db.user.create({
    data: { email: reviewerEmail, normalizedEmail: normalizeEmail(reviewerEmail), passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
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

  it("public review list: filter by star / responded, sort, and the summary still covers ALL reviews", async () => {
    const c = await createAgencyContext();
    try {
      const slug = (await db.agency.findUniqueOrThrow({ where: { id: c.agencyId }, select: { slug: true } })).slug;
      const seeded = [];
      for (const rating of [5, 3, 5]) {
        const r = await seedReview(c);
        await db.review.update({ where: { id: r.reviewId }, data: { rating } });
        seeded.push(r);
      }
      const au = await db.agencyUser.findFirstOrThrow({ where: { agencyId: c.agencyId }, select: { id: true } });
      await db.reviewResponse.create({ data: { reviewId: seeded[0].reviewId, agencyUserId: au.id, responseText: "Thank you!" } });

      const get = (qs: string) => request(app).get(`/agencies/${slug}/reviews${qs}`).then((r) => r.body.data);

      const all = await get("");
      expect(all.totalReviews).toBe(3);
      expect(all.respondedCount).toBe(1);
      expect(all.filteredTotal).toBe(3);

      const fives = await get("?rating=5");
      expect(fives.reviews).toHaveLength(2);
      expect(fives.filteredTotal).toBe(2);
      expect(fives.totalReviews).toBe(3); // the summary is unaffected by the filter
      expect(fives.starDistribution["3"]).toBeGreaterThan(0);

      expect((await get("?responded=true")).reviews.map((r: { id: string }) => r.id)).toEqual([seeded[0].reviewId]);
      expect((await get("?responded=false")).filteredTotal).toBe(2);
      expect((await get("?rating=3&responded=false")).reviews).toHaveLength(1);

      expect((await get("?sort=lowest")).reviews[0].rating).toBe(3);
      expect((await get("?sort=highest")).reviews[0].rating).toBe(5);

      // pages follow the FILTERED total, not the all-reviews total
      const p = await get("?rating=5&limit=1");
      expect(p.pages).toBe(2);
      // junk filter values are ignored, not errors
      expect((await get("?rating=9&responded=maybe&sort=zzz")).filteredTotal).toBe(3);
    } finally {
      await db.review.deleteMany({ where: { agencyId: c.agencyId } }).catch(() => {});
      await db.booking.deleteMany({ where: { agencyId: c.agencyId } }).catch(() => {});
      await c.cleanup();
    }
  });

  it("flagged list is the PENDING queue, paged, with dismissed history opt-in", async () => {
    const c = await createAgencyContext();
    try {
      const seeded = [];
      for (let i = 0; i < 3; i++) seeded.push(await seedReview(c));
      const flags = [];
      for (const r of seeded) flags.push(await db.reviewFlag.create({ data: { reviewId: r.reviewId, reason: "e2e", flaggedBy: "x" } }));
      await db.reviewFlag.update({ where: { id: flags[2].id }, data: { status: "DISMISSED" } });

      const ids = (b: { data: { flaggedReviews: { id: string }[] } }) => b.data.flaggedReviews.map((f) => f.id);

      const pending = (await request(app).get("/admin/reviews/flagged?limit=100").set(adminHeaders)).body;
      expect(ids(pending)).toEqual(expect.arrayContaining([flags[0].id, flags[1].id]));
      expect(ids(pending)).not.toContain(flags[2].id); // dismissed is history, not queue
      expect(pending.data.meta.total).toBeGreaterThanOrEqual(2);

      const all = (await request(app).get("/admin/reviews/flagged?limit=100&status=all").set(adminHeaders)).body;
      expect(ids(all)).toContain(flags[2].id);

      // Two pages of one row each never overlap and honour meta.
      const p1 = (await request(app).get("/admin/reviews/flagged?limit=1&page=1").set(adminHeaders)).body;
      const p2 = (await request(app).get("/admin/reviews/flagged?limit=1&page=2").set(adminHeaders)).body;
      expect(p1.data.flaggedReviews).toHaveLength(1);
      expect(p1.data.meta).toMatchObject({ page: 1, limit: 1 });
      expect(ids(p1)[0]).not.toBe(ids(p2)[0]);
    } finally {
      await db.review.deleteMany({ where: { agencyId: c.agencyId } }).catch(() => {});
      await db.booking.deleteMany({ where: { agencyId: c.agencyId } }).catch(() => {});
      await c.cleanup();
    }
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
