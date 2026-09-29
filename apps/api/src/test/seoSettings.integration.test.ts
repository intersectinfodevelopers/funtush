// SEO settings — integration test (backend catch-up pass). Real DB, skip if
// down. Exercises the real Prisma upsert/findUnique the mocked-service route
// tests (`routes/seoSettings.routes.test.ts`) cannot.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/seoSettings.service");

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
    where: { name: "SEOSETTINGS_TEST_TIER" },
    update: {},
    create: { name: "SEOSETTINGS_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/seoSettings.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[seoSettings.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";
let slug = "";

d("SEO settings (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    slug = `seo-${s}`;
    const a = await db.agency.create({
      data: { name: `Seo ${s}`, email: `seo-${s}@example.com`, slug, tierId },
    });
    agencyId = a.id;
  });

  afterAll(async () => {
    if (agencyId) {
      await db.agencySeoSettings.deleteMany({ where: { agencyId } }).catch(() => {});
      await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
    }
  });

  it("a never-saved agency gets all-null values, not an error", async () => {
    const settings = await svc.getSeoSettings(agencyId);
    expect(settings.values).toEqual({ metaTitle: null, metaDescription: null, ogImageUrl: null });
  });

  it("save → round-trips through a fresh read", async () => {
    await svc.updateSeoSettings(agencyId, {
      metaTitle: "Seo Trekking Co — Guided Himalayan Treks",
      metaDescription: "Small-group treks led by local guides.",
    });

    const reread = await svc.getSeoSettings(agencyId);
    expect(reread.values.metaTitle).toBe("Seo Trekking Co — Guided Himalayan Treks");
    expect(reread.values.metaDescription).toBe("Small-group treks led by local guides.");
    expect(reread.values.ogImageUrl).toBeNull();
  });

  it("a partial PATCH leaves the other fields untouched", async () => {
    await svc.updateSeoSettings(agencyId, { ogImageUrl: "https://cdn.funtush.com/seo-og.png" });

    const after = await svc.getSeoSettings(agencyId);
    expect(after.values.ogImageUrl).toBe("https://cdn.funtush.com/seo-og.png");
    expect(after.values.metaTitle).toBe("Seo Trekking Co — Guided Himalayan Treks");
  });

  it("null clears a field", async () => {
    await svc.updateSeoSettings(agencyId, { metaDescription: null });

    const after = await svc.getSeoSettings(agencyId);
    expect(after.values.metaDescription).toBeNull();
  });

  it("the public read by slug carries the same real values", async () => {
    const publicSettings = await svc.getPublicSeoSettingsBySlug(slug);
    expect(publicSettings.metaTitle).toBe("Seo Trekking Co — Guided Himalayan Treks");
  });

  it("404s a slug that does not exist", async () => {
    await expect(svc.getPublicSeoSettingsBySlug("no-such-agency")).rejects.toMatchObject({ status: 404 });
  });
});
