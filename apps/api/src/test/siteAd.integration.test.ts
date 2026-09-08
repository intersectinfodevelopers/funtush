// Site ads — integration test (Phase 2). Real DB, skip if down.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/siteAd.service");

let DB_AVAILABLE = false;
let db: Database["db"];
let svc: Svc;
let tierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;
  const tier = await db.subscriptionTier.upsert({
    where: { name: "SITEAD_TEST_TIER" },
    update: {},
    create: { name: "SITEAD_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/siteAd.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[siteAd.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";

d("Site ads (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    const a = await db.agency.create({
      data: { name: `Ad ${s}`, email: `ad-${s}@example.com`, slug: `ad-${s}`, tierId },
    });
    agencyId = a.id;
  });
  afterAll(async () => {
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
  });

  it("create → positions reflect it → pause → list filter → delete", async () => {
    const ad = await svc.createSiteAd(agencyId, {
      title: "Summer Trek Promo",
      image: "/assets/everest.png",
      position: "homepage-top",
      startDate: "2026-07-01",
      endDate: "2026-08-31",
      order: 1,
    });
    expect(ad.status).toBe("active");
    expect(ad.startDate).toBe("2026-07-01");

    let positions = await svc.listPositions(agencyId);
    expect(positions.find((p) => p.id === "homepage-top")).toMatchObject({ activeAds: 1, available: false });
    expect(positions.find((p) => p.id === "sidebar-1")).toMatchObject({ available: true });

    const paused = await svc.updateSiteAd(agencyId, ad.id, { status: "paused" });
    expect(paused.status).toBe("paused");

    positions = await svc.listPositions(agencyId);
    expect(positions.find((p) => p.id === "homepage-top")).toMatchObject({ activeAds: 0, available: true });

    expect((await svc.listSiteAds(agencyId, { status: "paused" })).total).toBe(1);
    expect((await svc.listSiteAds(agencyId, { status: "active" })).total).toBe(0);
    expect((await svc.listSiteAds(agencyId, { position: "homepage-top" })).total).toBe(1);

    await svc.deleteSiteAd(agencyId, ad.id);
    await expect(svc.getSiteAd(agencyId, ad.id)).rejects.toMatchObject({ status: 404 });
  });
});
