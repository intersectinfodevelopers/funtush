// ─────────────────────────────────────────────────────────────────────────────
// Admin agency management — end-to-end (API-wide docs/test pass, Batch 1).
//
// /admin/* is gated by requireAdmin, which needs resolveTenant to have marked
// the request as the admin context (see tier-config.e2e.test.ts). Skips
// cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { generateAccessToken } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

function platformAdminToken(): string {
  return generateAccessToken({
    userId: "e2e-platform-admin",
    roleType: "PLATFORM",
    role: "SUPER_ADMIN",
  } as Parameters<typeof generateAccessToken>[0]);
}

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };

d("Admin agency management (e2e)", () => {
  let ctx: E2EContext;
  // A second, separate agency for the visibility tests — the tier-change
  // test above mutates `ctx`'s tier away from a real tier name, and
  // `visibility.service.ts`'s `BASE_SCORE_BY_TIER` only maps the 4 real
  // tier names (FREE/SMALL/MEDIUM/LARGE); sharing one agency across both
  // would make whichever test runs second see a `tierName` outside that
  // map and produce NaN. Not a routing bug — a fixture-isolation one.
  let visibilityCtx: E2EContext;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    visibilityCtx = await createAgencyContext();

    // Get-or-create "MEDIUM" with an *empty* update clause — never
    // overwriting an existing row's limits — and repoint only the
    // dedicated visibility-test agency at it.
    const mediumTier = await db.subscriptionTier.upsert({
      where: { name: "MEDIUM" },
      update: {},
      create: { name: "MEDIUM", maxStaff: 25, maxGuides: 25, monthlyPrice: 59, features: {} },
      select: { id: true },
    });
    await db.agency.update({ where: { id: visibilityCtx.agencyId }, data: { tierId: mediumTier.id } });
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
    if (visibilityCtx) await visibilityCtx.cleanup();
  });

  it("is not reachable without the admin context", async () => {
    const res = await request(app).get("/admin/agencies");
    expect([401, 403, 404]).toContain(res.status);
  });

  it("GET /admin/agencies lists agencies with pagination metadata", async () => {
    const res = await request(app).get("/admin/agencies").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty("total");
    expect(res.body.meta).toHaveProperty("totalPages");
  });

  it("GET /admin/agencies filters by search and status", async () => {
    const agency = await db.agency.findUnique({ where: { id: ctx.agencyId }, select: { name: true } });

    const bySearch = await request(app)
      .get("/admin/agencies")
      .query({ search: agency?.name })
      .set(adminHeaders);
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.data.some((a: { id: string }) => a.id === ctx.agencyId)).toBe(true);

    const byStatus = await request(app).get("/admin/agencies").query({ status: "ACTIVE" }).set(adminHeaders);
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.data.every((a: { status: string }) => a.status === "ACTIVE")).toBe(true);
  });

  it("GET /admin/agencies/:id returns the full profile with booking/staff summaries", async () => {
    const res = await request(app).get(`/admin/agencies/${ctx.agencyId}`).set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ctx.agencyId);
    expect(res.body).toHaveProperty("staffCount");
    expect(res.body).toHaveProperty("bookingSummary");
    expect(res.body.kycStatus).toBe("NONE");
  });

  it("GET /admin/agencies/:id 404s for an unknown id", async () => {
    const res = await request(app).get("/admin/agencies/does-not-exist").set(adminHeaders);
    expect(res.status).toBe(404);
  });

  it("PATCH /:id/tier moves the agency to a different tier", async () => {
    const targetTier = await db.subscriptionTier.upsert({
      where: { name: "ADMIN_E2E_TARGET_TIER" },
      update: {},
      create: { name: "ADMIN_E2E_TARGET_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
      select: { name: true },
    });

    const res = await request(app)
      .patch(`/admin/agencies/${ctx.agencyId}/tier`)
      .set(adminHeaders)
      .send({ tier: targetTier.name });

    expect(res.status).toBe(200);
    expect(res.body.tier.name).toBe(targetTier.name);
  });

  it("PATCH /:id/tier rejects an unknown tier name", async () => {
    const res = await request(app)
      .patch(`/admin/agencies/${ctx.agencyId}/tier`)
      .set(adminHeaders)
      .send({ tier: "NOT_A_REAL_TIER" });
    expect(res.status).toBe(500);
  });

  it("PATCH /:id/status requires a reason", async () => {
    const res = await request(app)
      .patch(`/admin/agencies/${ctx.agencyId}/status`)
      .set(adminHeaders)
      .send({ status: "SUSPENDED" });
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/status suspends the agency with a reason, then reactivates it", async () => {
    const suspend = await request(app)
      .patch(`/admin/agencies/${ctx.agencyId}/status`)
      .set(adminHeaders)
      .send({ status: "SUSPENDED", reason: "E2E test suspension" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe("SUSPENDED");

    const reactivate = await request(app)
      .patch(`/admin/agencies/${ctx.agencyId}/status`)
      .set(adminHeaders)
      .send({ status: "ACTIVE", reason: "E2E test reactivation" });
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.status).toBe("ACTIVE");
  });

  it("PATCH /:id/visibility is unreachable without a platform-admin bearer token, even with admin-context headers", async () => {
    const res = await request(app)
      .patch(`/admin/agencies/${visibilityCtx.agencyId}/visibility`)
      .set(adminHeaders)
      .send({ admin_override: 25 });
    expect(res.status).toBe(401);
  });

  it("PATCH /:id/visibility rejects a tenant-scoped access token with 403", async () => {
    const res = await request(app)
      .patch(`/admin/agencies/${visibilityCtx.agencyId}/visibility`)
      .set(adminHeaders)
      .set("Authorization", `Bearer ${visibilityCtx.accessToken}`)
      .send({ admin_override: 25 });
    expect(res.status).toBe(403);
  });

  it("PATCH /:id/visibility sets a priority override and recomputes the visibility score", async () => {
    const res = await request(app)
      .patch(`/admin/agencies/${visibilityCtx.agencyId}/visibility`)
      .set(adminHeaders)
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ admin_override: 25 });

    expect(res.status).toBe(200);
    expect(res.body.priorityOverride).toBe(25);
    expect(res.body.sponsored).toBe(true);
    expect(typeof res.body.finalScore).toBe("number");
  });

  it("PATCH /:id/visibility rejects a negative override", async () => {
    const res = await request(app)
      .patch(`/admin/agencies/${visibilityCtx.agencyId}/visibility`)
      .set(adminHeaders)
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ admin_override: -1 });
    expect(res.status).toBe(400);
  });

  it("POST /:id/impersonate issues a short-lived token", async () => {
    const res = await request(app).post(`/admin/agencies/${ctx.agencyId}/impersonate`).set(adminHeaders);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.agencyId).toBe(ctx.agencyId);
    expect(res.body.ttlSeconds).toBe(15 * 60);
  });

  it("POST /:id/impersonate 404s for an unknown agency", async () => {
    const res = await request(app).post("/admin/agencies/does-not-exist/impersonate").set(adminHeaders);
    expect(res.status).toBe(404);
  });
});
