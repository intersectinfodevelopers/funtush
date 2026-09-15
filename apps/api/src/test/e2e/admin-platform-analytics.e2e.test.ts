// ─────────────────────────────────────────────────────────────────────────────
// Admin platform analytics — end-to-end (API-wide docs/test pass, Batch 1).
//
// Reads MongoDB analytics events + Postgres agency/tier data, 5-minute Redis
// cache in front. No write endpoints here, so this only proves the routes
// are reachable, admin-gated, and return the documented shape — not that
// every aggregation is numerically correct (that's `platformAnalytics.
// service.ts`'s own concern, and MongoDB event volume in a fresh test DB is
// zero, so most numeric fields are legitimately 0/empty here).
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };

d("Admin platform analytics (e2e)", () => {
  it("GET /admin/analytics is not reachable without the admin context", async () => {
    const res = await request(app).get("/admin/analytics");
    expect([401, 403, 404]).toContain(res.status);
  });

  it("GET /admin/analytics returns the platform overview shape", async () => {
    const res = await request(app).get("/admin/analytics").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalBookings");
    expect(res.body).toHaveProperty("monthlyBookings");
    expect(res.body).toHaveProperty("activeAgencies");
  });

  it("GET /admin/analytics/agencies returns agency performance data", async () => {
    const res = await request(app).get("/admin/analytics/agencies").set(adminHeaders);
    expect(res.status).toBe(200);
  });

  it("GET /admin/analytics/marketplace returns marketplace analytics", async () => {
    const res = await request(app).get("/admin/analytics/marketplace").set(adminHeaders);
    expect(res.status).toBe(200);
  });

  it("GET /admin/analytics/tiers returns tier conversion/churn data", async () => {
    const res = await request(app).get("/admin/analytics/tiers").set(adminHeaders);
    expect(res.status).toBe(200);
  });
});
