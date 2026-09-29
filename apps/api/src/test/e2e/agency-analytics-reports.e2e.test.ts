// ─────────────────────────────────────────────────────────────────────────────
// Agency analytics overview + reports + marketplace analytics — end-to-end
// (API-wide docs/test pass, Batch 3).
//
// Found and fixed along the way:
//   - `agency/analytics.route.ts` read `req.tier`, which no middleware
//     anywhere ever set — every request silently fell back to FREE-tier date
//     ranges, meaning paying MEDIUM/LARGE agencies were denied
//     `last_12_months`/`custom` windows. Fixed to resolve the tier from the
//     DB. Also dropped a check for a nonexistent "ENTERPRISE" tier.
//   - `agency/reports.route.ts` cached a report "pointer" with an empty S3
//     URL (no S3 upload code exists anywhere) — a second request for the
//     same month/format within 24h returned that broken pointer instead of
//     the report. Removed the fake cache; every request now regenerates and
//     streams the file directly, same as the (working) first request always
//     did.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("Agency analytics overview (e2e)", () => {
  it("401s without a token", async () => {
    const res = await request(app).get("/agencies/me/analytics");
    expect(res.status).toBe(401);
  });

  it("a FREE-tier agency gets the default overview with no period param", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app).get("/agencies/me/analytics").set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(200);
    await ctx.cleanup();
  });

  it("a FREE-tier agency is denied last_12_months with 403", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app)
      .get("/agencies/me/analytics")
      .query({ period: "last_12_months" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(403);
    await ctx.cleanup();
  });

  it("a MEDIUM-tier agency is allowed last_12_months (tier resolved from the DB, not req.tier)", async () => {
    const ctx = await createAgencyContext();
    const mediumTier = await db.subscriptionTier.upsert({
      where: { name: "MEDIUM" },
      update: {},
      create: { name: "MEDIUM", maxStaff: 25, maxGuides: 25, monthlyPrice: 59, features: {} },
      select: { id: true },
    });
    await db.agency.update({ where: { id: ctx.agencyId }, data: { tierId: mediumTier.id } });

    const res = await request(app)
      .get("/agencies/me/analytics")
      .query({ period: "last_12_months" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(200);
    await ctx.cleanup();
  });

  it("custom period requires from/to", async () => {
    const ctx = await createAgencyContext();
    const mediumTier = await db.subscriptionTier.findUnique({ where: { name: "MEDIUM" }, select: { id: true } });
    if (mediumTier) await db.agency.update({ where: { id: ctx.agencyId }, data: { tierId: mediumTier.id } });

    const res = await request(app)
      .get("/agencies/me/analytics")
      .query({ period: "custom" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(403);
    await ctx.cleanup();
  });

  it("the /packages, /customers, /guides sub-routes all respond 200", async () => {
    const ctx = await createAgencyContext();
    const headers = { "x-refresh-token": ctx.refreshToken };
    expect((await request(app).get("/agencies/me/analytics/packages").set(headers)).status).toBe(200);
    expect((await request(app).get("/agencies/me/analytics/customers").set(headers)).status).toBe(200);
    expect((await request(app).get("/agencies/me/analytics/guides").set(headers)).status).toBe(200);
    await ctx.cleanup();
  });
});

d("Agency reports (e2e)", () => {
  it("401s without a token", async () => {
    const res = await request(app).get("/agencies/me/reports/monthly").query({ month: "2026-01" });
    expect(res.status).toBe(401);
  });

  it("requires a well-formed month", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app)
      .get("/agencies/me/reports/monthly")
      .query({ month: "not-a-month" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(400);
    await ctx.cleanup();
  });

  // CSV, not PDF, for the "does the route actually work" tests below —
  // `toPDF` shells out to Puppeteer/Chrome, which isn't installed in this
  // sandbox (a pre-existing environment limitation, not a route bug). CSV
  // exercises the identical route logic (range resolution, no more fake
  // cache, streamed response) without needing a real browser binary.

  it("streams a CSV report directly (not a cached JSON pointer)", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app)
      .get("/agencies/me/reports/monthly")
      .query({ month: "2026-01", format: "csv" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    await ctx.cleanup();
  });

  it("a repeat request for the same month still streams the CSV, not a broken cache pointer", async () => {
    const ctx = await createAgencyContext();
    const headers = { "x-refresh-token": ctx.refreshToken };
    await request(app).get("/agencies/me/reports/monthly").query({ month: "2026-02", format: "csv" }).set(headers);

    const second = await request(app)
      .get("/agencies/me/reports/monthly")
      .query({ month: "2026-02", format: "csv" })
      .set(headers);
    expect(second.status).toBe(200);
    expect(second.headers["content-type"]).toContain("text/csv");
    expect(second.body).not.toHaveProperty("cached");
    await ctx.cleanup();
  });

  it("requires a well-formed year for /annual", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app)
      .get("/agencies/me/reports/annual")
      .query({ year: "abc" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(400);
    await ctx.cleanup();
  });

  it("streams an annual CSV report", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app)
      .get("/agencies/me/reports/annual")
      .query({ year: "2026", format: "csv" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    await ctx.cleanup();
  });
});

d("Marketplace analytics (e2e)", () => {
  it("401s the agency endpoints without a token", async () => {
    expect((await request(app).get("/agencies/me/marketplace/impressions")).status).toBe(401);
    expect((await request(app).get("/agencies/me/marketplace/conversions")).status).toBe(401);
  });

  it("GET /impressions returns performance for the default period", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app)
      .get("/agencies/me/marketplace/impressions")
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(200);
    await ctx.cleanup();
  });

  it("GET /impressions rejects an invalid period with 400", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app)
      .get("/agencies/me/marketplace/impressions")
      .query({ period: "last_5_years" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(400);
    await ctx.cleanup();
  });

  it("GET /conversions rejects window_hours out of range", async () => {
    const ctx = await createAgencyContext();
    const res = await request(app)
      .get("/agencies/me/marketplace/conversions")
      .query({ window_hours: "9999" })
      .set({ "x-refresh-token": ctx.refreshToken });
    expect(res.status).toBe(400);
    await ctx.cleanup();
  });

  it("GET /admin/marketplace/top-agencies is unreachable without a super-admin bearer token", async () => {
    const res = await request(app).get("/admin/marketplace/top-agencies");
    expect(res.status).toBe(401);
  });
});
