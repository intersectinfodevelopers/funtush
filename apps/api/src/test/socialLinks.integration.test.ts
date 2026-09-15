// Social links — integration test (backend catch-up pass). Real DB, skip if
// down. Exercises the real Prisma upsert/findUnique the mocked-service route
// tests (`routes/socialLinks.routes.test.ts`) cannot.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/socialLinks.service");

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
    where: { name: "SOCIALLINKS_TEST_TIER" },
    update: {},
    create: { name: "SOCIALLINKS_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/socialLinks.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[socialLinks.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";
let slug = "";

d("Social links (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    slug = `social-${s}`;
    const a = await db.agency.create({
      data: { name: `Social ${s}`, email: `social-${s}@example.com`, slug, tierId },
    });
    agencyId = a.id;
  });

  afterAll(async () => {
    if (agencyId) {
      await db.agencySocialLinks.deleteMany({ where: { agencyId } }).catch(() => {});
      await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
    }
  });

  it("a never-saved agency gets all-null values, not an error", async () => {
    const links = await svc.getSocialLinks(agencyId);
    expect(links.values).toEqual({
      facebookUrl: null,
      instagramUrl: null,
      tiktokUrl: null,
      whatsappNumber: null,
      youtubeUrl: null,
    });
  });

  it("save → round-trips through a fresh read", async () => {
    await svc.updateSocialLinks(agencyId, {
      facebookUrl: "https://facebook.com/social-trek",
      whatsappNumber: "9779841234567",
    });

    const reread = await svc.getSocialLinks(agencyId);
    expect(reread.values.facebookUrl).toBe("https://facebook.com/social-trek");
    expect(reread.values.whatsappNumber).toBe("9779841234567");
    // Untouched fields stay null — the upsert did not clobber them.
    expect(reread.values.instagramUrl).toBeNull();
  });

  it("a partial PATCH leaves the other links untouched", async () => {
    await svc.updateSocialLinks(agencyId, { instagramUrl: "https://instagram.com/social-trek" });

    const after = await svc.getSocialLinks(agencyId);
    expect(after.values.instagramUrl).toBe("https://instagram.com/social-trek");
    // Still what the previous test saved.
    expect(after.values.facebookUrl).toBe("https://facebook.com/social-trek");
  });

  it("null clears a link", async () => {
    await svc.updateSocialLinks(agencyId, { facebookUrl: null });

    const after = await svc.getSocialLinks(agencyId);
    expect(after.values.facebookUrl).toBeNull();
  });

  it("the public read builds a real wa.me link from the stored number", async () => {
    const publicLinks = await svc.getPublicSocialLinksBySlug(slug);
    expect(publicLinks.whatsappLink).toBe("https://wa.me/9779841234567");
  });

  it("404s a slug that does not exist", async () => {
    await expect(svc.getPublicSocialLinksBySlug("no-such-agency")).rejects.toMatchObject({ status: 404 });
  });
});
