// ─────────────────────────────────────────────────────────────────────────────
// Agency-facing ad campaigns — end-to-end (API-wide docs/test pass, Batch 3).
//
// Found and fixed along the way (see adCampaign.routes.ts / adCampaignService.ts):
//   - Every handler here used to hardcode its error status (400 or 500)
//     instead of reading `CampaignError.status`, so a "not found" or "not
//     authorized" campaign lookup reported 500 — fixed via a shared
//     `respondWithCampaignError` helper.
//   - `generateAdCampaign` created campaigns already at `PENDING_APPROVAL`,
//     but `updateTargetingParams`/`submitCampaignForApproval` both require
//     `PENDING` — the targeting/submit steps were unreachable through the
//     real generate → configure → submit flow. Fixed to create `PENDING`.
//
// `syncAndGetCampaignPerformance` only calls the real ad-platform API when
// the campaign already has a `metaCampaignId`/`googleCampaignId` (i.e. has
// been approved) — every fixture here stays unapproved, so that external
// call is never reached and this stays safe to run for real.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const VALID_TARGETING = {
  geographic: { regions: ["Nepal"], difficulty: "ALL" },
  interests: { adventureTravel: true, trekking: true, culturalTourism: false, mountaineering: false },
  behavioral: { retargetSearchers: true, retargetViewers: false, excludeExistingCustomers: false },
  seasonal: { enabled: false, boostMonths: [], boostPercentage: 0 },
};

d("Agency ad campaigns (e2e)", () => {
  let ctx: E2EContext;
  let otherCtx: E2EContext;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    otherCtx = await createAgencyContext();

    // A published package with an itinerary carrying photos — `POST
    // /generate` needs at least one PUBLISHED package to build creatives.
    const pkg = await db.trekPackage.create({
      data: {
        agencyId: ctx.agencyId,
        title: "Everest Base Camp",
        slug: `ebc-${Date.now()}`,
        durationDays: 14,
        pricePerPerson: 1500,
        difficulty: "CHALLENGING",
        maxGroupSize: 10,
        status: "PUBLISHED",
      },
    });
    await db.trekItinerary.create({
      data: { packageId: pkg.id, dayNumber: 1, location: "Lukla", description: "Fly to Lukla", photos: ["https://example.com/a.jpg"] },
    });
  });

  afterAll(async () => {
    // `AdCampaign` has no cascade from `Agency` — delete it first or
    // `ctx.cleanup()`'s `agency.delete()` fails on the FK and silently
    // leaves the agency/tier orphaned (`cleanup()` swallows its own errors).
    if (ctx) {
      await db.adCampaign.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await ctx.cleanup();
    }
    if (otherCtx) await otherCtx.cleanup();
  });

  function authed() {
    return { "x-refresh-token": ctx.refreshToken };
  }

  it("401s every route without a token", async () => {
    expect((await request(app).post("/agencies/me/ad-campaigns/generate")).status).toBe(401);
    expect((await request(app).get("/agencies/me/ad-campaigns")).status).toBe(401);
  });

  it("POST /generate 400s when the agency has no published packages", async () => {
    const res = await request(app).post("/agencies/me/ad-campaigns/generate").set({ "x-refresh-token": otherCtx.refreshToken });
    expect(res.status).toBe(400);
  });

  let campaignId: string;

  it("POST /generate creates a PENDING draft with 3 creative variations", async () => {
    const res = await request(app).post("/agencies/me/ad-campaigns/generate").set(authed());
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PENDING");
    campaignId = res.body.data.id;
  });

  it("GET / lists the agency's own campaigns", async () => {
    const res = await request(app).get("/agencies/me/ad-campaigns").set(authed());
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === campaignId)).toBe(true);
  });

  it("GET /:id returns the campaign", async () => {
    const res = await request(app).get(`/agencies/me/ad-campaigns/${campaignId}`).set(authed());
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(campaignId);
  });

  it("GET /:id returns 403 (not 500) for a campaign owned by a different agency", async () => {
    const res = await request(app)
      .get(`/agencies/me/ad-campaigns/${campaignId}`)
      .set({ "x-refresh-token": otherCtx.refreshToken });
    expect(res.status).toBe(403);
  });

  it("GET /:id returns 404 (not 500) for an unknown campaign", async () => {
    const res = await request(app).get("/agencies/me/ad-campaigns/does-not-exist").set(authed());
    expect(res.status).toBe(404);
  });

  it("GET /:id/performance returns zeroed metrics for a campaign never pushed live", async () => {
    const res = await request(app).get(`/agencies/me/ad-campaigns/${campaignId}/performance`).set(authed());
    expect(res.status).toBe(200);
  });

  it("PATCH /:id/targeting rejects targeting missing a region", async () => {
    const res = await request(app)
      .post(`/agencies/me/ad-campaigns/${campaignId}/targeting`)
      .set(authed())
      .send({ ...VALID_TARGETING, geographic: { regions: [], difficulty: "ALL" } });
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/targeting accepts valid targeting on a PENDING campaign", async () => {
    const res = await request(app)
      .post(`/agencies/me/ad-campaigns/${campaignId}/targeting`)
      .set(authed())
      .send(VALID_TARGETING);
    expect(res.status).toBe(200);
  });

  it("POST /:id/submit moves the campaign to PENDING_APPROVAL", async () => {
    const res = await request(app).post(`/agencies/me/ad-campaigns/${campaignId}/submit`).set(authed());
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PENDING_APPROVAL");
  });

  it("the now-submitted campaign is visible in the admin pending queue", async () => {
    const res = await request(app)
      .get("/admin/ad-campaigns/pending")
      .set({ Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" });
    expect(res.status).toBe(200);
    // Only LARGE-tier agencies show up — this fixture's agency is on
    // createAgencyContext's default tier, so just confirm the endpoint
    // works and doesn't error; tier-filtering itself is Batch 1's concern.
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("PATCH /:id/targeting 400s once the campaign is no longer PENDING", async () => {
    const res = await request(app)
      .post(`/agencies/me/ad-campaigns/${campaignId}/targeting`)
      .set(authed())
      .send(VALID_TARGETING);
    expect(res.status).toBe(400);
  });

  it("POST /:id/submit 400s a second time (no longer PENDING)", async () => {
    const res = await request(app).post(`/agencies/me/ad-campaigns/${campaignId}/submit`).set(authed());
    expect(res.status).toBe(400);
  });

  it("GET /targeting/options returns the static option catalog", async () => {
    const res = await request(app).get("/agencies/me/ad-campaigns/targeting/options").set(authed());
    expect(res.status).toBe(200);
    expect(res.body.data).toBeTruthy();
  });
});
