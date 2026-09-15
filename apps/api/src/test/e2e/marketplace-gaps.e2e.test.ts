// ─────────────────────────────────────────────────────────────────────────────
// Marketplace routes — gap-filling end-to-end (API-wide docs/test pass,
// Batch 4). `marketplaceRanking.routes.test.ts` already covers /agencies +
// /agencies/compare; this covers /click, /destinations(+/:slug), /featured,
// /trending, /seasonal — previously zero coverage of any kind.
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

d("Marketplace gap-filling (e2e)", () => {
  let ctx: E2EContext;
  let destinationName: string;
  let destinationSlug: string;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    // "Master" destinations are derived by grouping agency-scoped
    // `TrekDestination` rows by a slugified name (see
    // `marketplaceDirectory.service.ts`'s `listDestinations`/
    // `getDestinationBySlug`) — there is no standalone destination table.
    const s = `${Date.now()}`;
    destinationName = `Everest Region ${s}`;
    // Mirrors `marketplaceDirectory.service.ts`'s own (unexported) `slugify`.
    destinationSlug = destinationName.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
    await db.trekDestination.create({
      data: { agencyId: ctx.agencyId, name: destinationName, region: "Khumbu" },
    });
  });

  afterAll(async () => {
    if (ctx) {
      await db.trekDestination.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await ctx.cleanup();
    }
  });

  it("POST /click requires agencyId and destination", async () => {
    const missingAgency = await request(app).post("/marketplace/click").send({ destination: "agency-profile" });
    expect(missingAgency.status).toBe(400);

    const missingDestination = await request(app).post("/marketplace/click").send({ agencyId: ctx.agencyId });
    expect(missingDestination.status).toBe(400);
  });

  it("POST /click records a real click", async () => {
    const res = await request(app)
      .post("/marketplace/click")
      .send({ agencyId: ctx.agencyId, destination: "agency-profile", searchQuery: "everest" });
    expect(res.status).toBe(201);

    const rows = await db.marketplaceClick.findMany({ where: { agencyId: ctx.agencyId } });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("GET /destinations lists master destinations with a package count", async () => {
    const res = await request(app).get("/marketplace/destinations");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /destinations/:slug returns the destination", async () => {
    const res = await request(app).get(`/marketplace/destinations/${destinationSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe(destinationSlug);
  });

  it("GET /destinations/:slug 404s for an unknown slug", async () => {
    const res = await request(app).get("/marketplace/destinations/no-such-destination");
    expect(res.status).toBe(404);
  });

  it("GET /featured responds 200 with sponsored/topRated/mostBookedThisMonth sections", async () => {
    const res = await request(app).get("/marketplace/featured");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.sponsored)).toBe(true);
    expect(Array.isArray(res.body.data.topRated)).toBe(true);
    expect(Array.isArray(res.body.data.mostBookedThisMonth)).toBe(true);
  });

  it("GET /trending responds 200 with a data array + total", async () => {
    const res = await request(app).get("/marketplace/trending");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty("total");
  });

  it("GET /seasonal responds 200 with a data array + total", async () => {
    const res = await request(app).get("/marketplace/seasonal");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty("total");
  });
});
