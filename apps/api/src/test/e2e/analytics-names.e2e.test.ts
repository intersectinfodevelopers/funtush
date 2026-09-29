// Agency analytics: ids in the event stream come back with display names, scoped to the agency.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { getAnalyticsCollection } from "../../models/analyticsEvent.model";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("analytics names (e2e)", () => {
  let ctx: E2EContext;
  let other: E2EContext;
  let pkgId: string;
  let otherPkgId: string;
  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    other = await createAgencyContext();
    pkgId = (await seedPackage(ctx.agencyId)).packageId;
    otherPkgId = (await seedPackage(other.agencyId)).packageId;
    const col = await getAnalyticsCollection();
    const now = new Date();
    await col.insertMany([
      { agency_id: ctx.agencyId, event_type: "BOOKING_CONFIRMED", trekker_id: "t-x", package_id: pkgId, timestamp: now, metadata: { guide_id: "g-ref-1" } },
      { agency_id: ctx.agencyId, event_type: "BOOKING_PAID", trekker_id: "t-x", package_id: pkgId, timestamp: now, metadata: { amount: 500, country: "NP" } },
      // another agency's package id must never be named for this agency
      { agency_id: ctx.agencyId, event_type: "BOOKING_CONFIRMED", trekker_id: "t-y", package_id: otherPkgId, timestamp: now, metadata: {} },
    ] as never);
    await db.guideProfile.create({ data: { agencyId: ctx.agencyId, guideRef: "g-ref-1", fullName: "Pemba Sherpa", phone: "+9779800000000" } as never }).catch(() => undefined);
  });
  afterAll(async () => {
    const col = await getAnalyticsCollection();
    await col.deleteMany({ agency_id: { $in: [ctx?.agencyId, other?.agencyId] } });
    await db.guideProfile.deleteMany({ where: { agencyId: ctx?.agencyId } }).catch(() => undefined);
    await ctx?.cleanup();
    await other?.cleanup();
  });
  const get = (p: string) => request(app).get(`/agencies/me/analytics${p}`).set("x-refresh-token", ctx.refreshToken);

  it("names the agency's own packages, never another agency's", async () => {
    const r = await get("/packages");
    expect(r.status).toBe(200);
    const mine = r.body.topByBookings.find((p: { package_id: string }) => p.package_id === pkgId);
    const foreign = r.body.topByBookings.find((p: { package_id: string }) => p.package_id === otherPkgId);
    expect(typeof mine.title).toBe("string");
    expect(foreign.title).toBeNull();
  });

  it("names guides via their guideRef", async () => {
    const r = await get("/guides");
    expect(r.status).toBe(200);
    expect(r.body.guides[0].name).toBe("Pemba Sherpa");
  });

  it("keeps the overview numbers", async () => {
    const r = await get("");
    expect(r.body.summary.totalRevenue).toBe(500);
    expect(r.body.summary.totalBookings).toBe(2);
  });
});
