// ─────────────────────────────────────────────────────────────────────────────
// Admin ad-campaign review — end-to-end (API-wide docs/test pass, Batch 1).
//
// The read routes (`/pending`, `/active`) sit behind `requireAdmin` like
// every other admin route. The three mutating routes
// (`/:id/approve`, `/:id/reject`, `/:id/pause`) carry their own independent
// gate — `requireAuth` + `requireSuperAdminRole` (a platform-admin JWT via
// `Authorization: Bearer`, a different credential shape than
// `x-refresh-token`) — because `approveCampaign`/`pauseCampaign` call out to
// real ad-platform APIs (`lib/adPlatforms.ts`) regardless of `requireAdmin`'s
// current dev-only bypass. Only the auth gate on approve/pause is exercised
// here, not the external call itself — that would need mocking
// `lib/adPlatforms.ts`, out of scope for a routing/coverage pass.
// `rejectCampaign` makes no external call, so its full success path is
// covered directly.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { generateAccessToken } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };

function platformAdminToken(): string {
  return generateAccessToken({
    userId: "e2e-platform-admin",
    roleType: "PLATFORM",
    role: "SUPER_ADMIN",
  } as Parameters<typeof generateAccessToken>[0]);
}

d("Admin ad-campaign review (e2e)", () => {
  let ctx: E2EContext;
  let largeTierAgencyId: string;
  let pendingCampaignId: string;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();

    const largeTier = await db.subscriptionTier.upsert({
      where: { name: "LARGE" },
      update: {},
      create: { name: "LARGE", maxStaff: 50, maxGuides: 50, monthlyPrice: 199, features: {} },
      select: { id: true },
    });

    const largeAgency = await db.agency.create({
      data: {
        name: `AdCampaign E2E ${Date.now()}`,
        email: `adcampaign-e2e-${Date.now()}@example.com`,
        slug: `adcampaign-e2e-${Date.now()}`,
        tierId: largeTier.id,
      },
      select: { id: true },
    });
    largeTierAgencyId = largeAgency.id;

    const campaign = await db.adCampaign.create({
      data: {
        agencyId: largeTierAgencyId,
        status: "PENDING_APPROVAL",
        imageUrls: ["https://example.com/ad.jpg"],
        copyText: "Trek the Himalayas",
        targetingParams: { regions: ["Nepal"] },
      },
      select: { id: true },
    });
    pendingCampaignId = campaign.id;
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
    if (largeTierAgencyId) await db.agency.delete({ where: { id: largeTierAgencyId } }).catch(() => {});
  });

  it("GET /pending is not reachable without the admin context", async () => {
    const res = await request(app).get("/admin/ad-campaigns/pending");
    expect([401, 403, 404]).toContain(res.status);
  });

  it("GET /pending lists PENDING_APPROVAL campaigns from LARGE-tier agencies only", async () => {
    const res = await request(app).get("/admin/ad-campaigns/pending").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === pendingCampaignId)).toBe(true);
  });

  it("GET /active lists only ACTIVE campaigns", async () => {
    const res = await request(app).get("/admin/ad-campaigns/active").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data.every((c: { status: string }) => c.status === "ACTIVE")).toBe(true);
  });

  it("PATCH /:id/approve is unreachable without a platform-admin bearer token, even with admin-context headers", async () => {
    const res = await request(app).patch(`/admin/ad-campaigns/${pendingCampaignId}/approve`).set(adminHeaders);
    expect(res.status).toBe(401);
  });

  it("PATCH /:id/pause rejects a tenant-scoped access token with 403", async () => {
    const res = await request(app)
      .patch(`/admin/ad-campaigns/${pendingCampaignId}/pause`)
      .set(adminHeaders)
      .set("Authorization", `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("PATCH /:id/reject requires a reason", async () => {
    const res = await request(app)
      .patch(`/admin/ad-campaigns/${pendingCampaignId}/reject`)
      .set(adminHeaders)
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/reject with a platform-admin token rejects the campaign", async () => {
    const res = await request(app)
      .patch(`/admin/ad-campaigns/${pendingCampaignId}/reject`)
      .set(adminHeaders)
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ reason: "Creative does not meet guidelines" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REJECTED");
    expect(res.body.data.rejectionReason).toBe("Creative does not meet guidelines");
  });

  it("PATCH /:id/reject 409s once already rejected", async () => {
    const res = await request(app)
      .patch(`/admin/ad-campaigns/${pendingCampaignId}/reject`)
      .set(adminHeaders)
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ reason: "Again" });
    expect(res.status).toBe(409);
  });

  it("PATCH /:id/reject 404s for an unknown id", async () => {
    const res = await request(app)
      .patch("/admin/ad-campaigns/does-not-exist/reject")
      .set(adminHeaders)
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ reason: "n/a" });
    expect(res.status).toBe(404);
  });
});
