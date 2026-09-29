// Page builder — integration test (backend catch-up pass, Phase 8). Real DB,
// skip if down. Exercises the real Prisma transaction (upsert settings row +
// delete/recreate sections) the mocked-service route tests cannot.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/sitePage.service");

let DB_AVAILABLE = false;
let db: Database["db"];
let svc: Svc;
let freeTierId = "";
let paidTierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;

  const freeTier = await db.subscriptionTier.upsert({
    where: { name: "FREE" },
    update: {},
    create: { name: "FREE", maxStaff: 1, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  freeTierId = freeTier.id;

  const paidTier = await db.subscriptionTier.upsert({
    where: { name: "SITEPAGE_TEST_PAID_TIER" },
    update: {},
    create: { name: "SITEPAGE_TEST_PAID_TIER", maxStaff: 10, maxGuides: 50, monthlyPrice: 59, features: {} },
    select: { id: true },
  });
  paidTierId = paidTier.id;

  svc = await import("../services/sitePage.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[sitePage.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

d("Page builder (real DB)", () => {
  let freeAgencyId = "";
  let paidAgencyId = "";
  let freeAgencySlug = "";
  let paidAgencySlug = "";

  beforeAll(async () => {
    const s = `${Date.now()}`;
    freeAgencySlug = `sitepage-free-${s}`;
    paidAgencySlug = `sitepage-paid-${s}`;

    const freeAgency = await db.agency.create({
      data: { name: `SitePage Free ${s}`, email: `sitepage-free-${s}@example.com`, slug: freeAgencySlug, tierId: freeTierId },
    });
    freeAgencyId = freeAgency.id;

    const paidAgency = await db.agency.create({
      data: { name: `SitePage Paid ${s}`, email: `sitepage-paid-${s}@example.com`, slug: paidAgencySlug, tierId: paidTierId },
    });
    paidAgencyId = paidAgency.id;
  });

  afterAll(async () => {
    for (const id of [freeAgencyId, paidAgencyId]) {
      if (id) await db.agency.delete({ where: { id } }).catch(() => {});
    }
  });

  it("a never-saved agency resolves to the default template's starter sections, not an error", async () => {
    const page = await svc.getSitePage(freeAgencyId);

    expect(page.templateId).toBeNull();
    expect(page.variant).toBe("CLASSIC");
    expect(page.header.style).toBe("STANDARD");
    expect(page.footer.style).toBe("BASIC");
    expect(page.sections.length).toBeGreaterThan(0);
    expect(page.sections[0].type).toBe("TOPBAR");
    expect(page.updatedAt).toBeNull();
  });

  it("PATCH with chrome fields only leaves sections untouched (still the virtual starter set)", async () => {
    const before = await svc.getSitePage(freeAgencyId);
    expect(before.sections.length).toBeGreaterThan(0);

    const updated = await svc.updateSitePage(freeAgencyId, { headerSticky: false, name: "My Trekking Site" });

    expect(updated.header.sticky).toBe(false);
    expect(updated.name).toBe("My Trekking Site");
    // A row now exists, so the sections come from the (still empty) table —
    // chrome-only PATCH never touches `sections`.
    expect(updated.sections.length).toBe(0);
  });

  it("PATCH with a section list replaces it, and round-trips through a fresh read", async () => {
    await svc.updateSitePage(freeAgencyId, {
      sections: [
        { type: "HERO", title: "Welcome to the Himalayas", widthPercent: 100 },
        { type: "TEXTBLOCK", title: "About", text: "We run treks.", widthPercent: 50 },
        { type: "PACKAGES", itemCount: 6, selectedIds: ["pkg-1", "pkg-2"], widthPercent: 50 },
      ],
    });

    const reread = await svc.getSitePage(freeAgencyId);
    expect(reread.sections).toHaveLength(3);
    expect(reread.sections[0].type).toBe("HERO");
    expect(reread.sections[0].title).toBe("Welcome to the Himalayas");
    expect(reread.sections[1].position).toBe(1);
    expect(reread.sections[2].selectedIds).toEqual(["pkg-1", "pkg-2"]);
  });

  it("a second PATCH with a shorter section list fully replaces the first, not merges it", async () => {
    await svc.updateSitePage(freeAgencyId, {
      sections: [{ type: "GALLERY", itemCount: 4 }],
    });

    const reread = await svc.getSitePage(freeAgencyId);
    expect(reread.sections).toHaveLength(1);
    expect(reread.sections[0].type).toBe("GALLERY");
    expect(reread.sections[0].position).toBe(0);
  });

  it("reordering (sending the same sections in a new order) renumbers position from the array index", async () => {
    await svc.updateSitePage(freeAgencyId, {
      sections: [
        { type: "HERO", title: "A" },
        { type: "TEXTBLOCK", title: "B" },
      ],
    });

    await svc.updateSitePage(freeAgencyId, {
      sections: [
        { type: "TEXTBLOCK", title: "B" },
        { type: "HERO", title: "A" },
      ],
    });

    const reread = await svc.getSitePage(freeAgencyId);
    expect(reread.sections[0].type).toBe("TEXTBLOCK");
    expect(reread.sections[0].position).toBe(0);
    expect(reread.sections[1].type).toBe("HERO");
    expect(reread.sections[1].position).toBe(1);
  });

  it("rejects an empty PATCH body with a 400", async () => {
    await expect(svc.updateSitePage(freeAgencyId, {})).rejects.toMatchObject({ status: 400 });
  });

  it("a FREE-tier agency applying a paid template is rejected with 403, and nothing is written", async () => {
    const before = await svc.getSitePage(freeAgencyId);

    await expect(svc.applySiteTemplate(freeAgencyId, "adventure-landing")).rejects.toMatchObject({ status: 403 });

    const after = await svc.getSitePage(freeAgencyId);
    expect(after.templateId).toBe(before.templateId);
  });

  it("a FREE-tier agency applying the free template succeeds and replaces sections", async () => {
    const applied = await svc.applySiteTemplate(freeAgencyId, "classic-trek-operator");

    expect(applied.templateId).toBe("classic-trek-operator");
    expect(applied.variant).toBe("CLASSIC");
    expect(applied.sections.length).toBeGreaterThan(0);
    expect(applied.sections[0].type).toBe("TOPBAR");
  });

  it("applying a template preserves header/footer chrome set by an earlier PATCH", async () => {
    await svc.updateSitePage(paidAgencyId, { headerStyle: "CTA", footerStyle: "GRID" });

    const applied = await svc.applySiteTemplate(paidAgencyId, "adventure-landing");

    expect(applied.header.style).toBe("CTA");
    expect(applied.footer.style).toBe("GRID");
    expect(applied.templateId).toBe("adventure-landing");
  });

  it("applySiteTemplate rejects an unknown template id with 404", async () => {
    await expect(svc.applySiteTemplate(paidAgencyId, "does-not-exist")).rejects.toMatchObject({ status: 404 });
  });

  it("the public read resolves an agency's saved page by slug", async () => {
    await svc.applySiteTemplate(paidAgencyId, "boutique-trekking");

    const result = await svc.getPublicSitePageBySlug(paidAgencySlug);
    expect(result.agencySlug).toBe(paidAgencySlug);
    expect(result.templateId).toBe("boutique-trekking");
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it("the public read 404s for an unknown slug", async () => {
    await expect(svc.getPublicSitePageBySlug("no-such-agency-slug")).rejects.toMatchObject({ status: 404 });
  });

  it("the public read 404s for a suspended agency", async () => {
    await db.agency.update({ where: { id: paidAgencyId }, data: { status: "SUSPENDED" } });

    await expect(svc.getPublicSitePageBySlug(paidAgencySlug)).rejects.toMatchObject({ status: 404 });

    await db.agency.update({ where: { id: paidAgencyId }, data: { status: "ACTIVE" } });
  });
});
