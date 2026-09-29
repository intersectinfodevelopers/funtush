// GET /agencies/me/dashboard — documented and implemented but never mounted (it
// 404'd), so no frontend could show an agency's home page. Real DBs.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("Agency dashboard summary (e2e)", () => {
  let ctx: E2EContext;
  let other: E2EContext;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    other = await createAgencyContext();
    await seedPackage(ctx.agencyId);
    await seedPackage(other.agencyId);
    await seedPackage(other.agencyId);
  });
  afterAll(async () => {
    await ctx?.cleanup();
    await other?.cleanup();
  });

  it("requires a session", async () => {
    expect((await request(app).get("/agencies/me/dashboard")).status).toBe(401);
  });

  it("returns the caller's agency, tier and counts — scoped to that agency only", async () => {
    const r = await request(app).get("/agencies/me/dashboard").set("x-refresh-token", ctx.refreshToken);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.agency.id).toBe(ctx.agencyId);
    expect(r.body.data.agency.tier.name).toBeTruthy();
    expect(r.body.data.stats.packages).toBe(1); // not the other agency's 2
    expect(r.body.data.stats).toMatchObject({ totalBookings: 0, pendingInquiries: 0, staff: 1 });
  });

  it("does not leak raw relations (user rows, subscriptions, verification token)", async () => {
    const r = await request(app).get("/agencies/me/dashboard").set("x-refresh-token", ctx.refreshToken);
    const a = r.body.data.agency;
    expect(a).not.toHaveProperty("users");
    expect(a).not.toHaveProperty("subscriptions");
    expect(a).not.toHaveProperty("customDomainVerificationToken");
  });
});
