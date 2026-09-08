// ─────────────────────────────────────────────────────────────────────────────
// Admin subscription-tier config — end-to-end.
//
// /admin/* is gated by requireAdmin, which needs resolveTenant to have marked
// the request as the admin context. Outside production that happens for
// Host: admin.funtush.com from a whitelisted IP (default 127.0.0.1). Supertest
// runs in-process, so we set the Host header and an X-Forwarded-For that
// resolveTenant's getClientIp() will read.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };

d("Admin tier config (e2e)", () => {
  const createdTierIds: string[] = [];

  afterAll(async () => {
    for (const id of createdTierIds) {
      await db.subscriptionTier.delete({ where: { id } }).catch(() => {});
    }
  });

  it("is not reachable without the admin context", async () => {
    const res = await request(app).get("/admin/tiers");
    expect([401, 403, 404]).toContain(res.status);
  });

  it("GET /admin/tiers lists tiers with the full Concept §6 config", async () => {
    const res = await request(app).get("/admin/tiers").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("marketplaceWeight");
    expect(res.body.data[0]).toHaveProperty("adsEnabled");
    expect(res.body.data[0]).toHaveProperty("trialDays");
  });

  it("POST creates a tier; PATCH updates limits + flags; negatives are rejected", async () => {
    const name = `E2E_TIER_CFG_${Date.now()}`;
    const create = await request(app)
      .post("/admin/tiers")
      .set(adminHeaders)
      .send({ name, maxStaff: 3, maxGuides: 3, maxPackages: 5, monthlyPrice: 29, trialDays: 14 });
    expect(create.status).toBe(201);
    expect(create.body.data.name).toBe(name);
    createdTierIds.push(create.body.data.id);

    const patch = await request(app)
      .patch(`/admin/tiers/${create.body.data.id}`)
      .set(adminHeaders)
      .send({ maxGuides: 10, adsEnabled: true, marketplaceWeight: 50, annualPrice: 290 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.maxGuides).toBe(10);
    expect(patch.body.data.adsEnabled).toBe(true);
    expect(patch.body.data.marketplaceWeight).toBe(50);
    expect(patch.body.data.annualPrice).toBe(290);

    const bad = await request(app)
      .patch(`/admin/tiers/${create.body.data.id}`)
      .set(adminHeaders)
      .send({ maxStaff: -1 });
    expect(bad.status).toBe(400);
  });

  it("POST with a duplicate name → 409", async () => {
    const name = `E2E_TIER_DUP_${Date.now()}`;
    const first = await request(app).post("/admin/tiers").set(adminHeaders).send({ name });
    createdTierIds.push(first.body.data.id);
    const second = await request(app).post("/admin/tiers").set(adminHeaders).send({ name });
    expect(second.status).toBe(409);
  });

  it("PATCH an unknown tier → 404", async () => {
    const res = await request(app).patch("/admin/tiers/does-not-exist").set(adminHeaders).send({ maxStaff: 1 });
    expect(res.status).toBe(404);
  });
});
