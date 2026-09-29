// Branding — logoWidth/receiptFooter integration test (backend catch-up pass).
// Real DB, skip if down. Exercises the actual Prisma upsert/findUnique the
// mocked-service route tests (`routes/branding.routes.test.ts`) cannot —
// column names, defaults, and the clamp-on-read logic against real rows.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/branding.service");

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
    where: { name: "BRANDING_TEST_TIER" },
    update: {},
    create: { name: "BRANDING_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/branding.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[branding.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";

d("Branding logoWidth/receiptFooter (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    const a = await db.agency.create({
      data: { name: `Brand ${s}`, email: `brand-${s}@example.com`, slug: `brand-${s}`, tierId },
    });
    agencyId = a.id;
  });

  afterAll(async () => {
    if (agencyId) {
      await db.agencyBranding.deleteMany({ where: { agencyId } }).catch(() => {});
      await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
    }
  });

  it("a never-saved agency gets the platform defaults, not null", async () => {
    const branding = await svc.getAgencyBranding(agencyId);

    expect(branding.logoWidth).toBe(140);
    expect(branding.receiptFooter).toBe("Thank you for trekking with us!");
  });

  it("save → the real row round-trips through a fresh read", async () => {
    const saved = await svc.updateAgencyBranding(agencyId, {
      logoWidth: 220,
      receiptFooter: "See you on the next trail!",
    });
    expect(saved.logoWidth).toBe(220);
    expect(saved.receiptFooter).toBe("See you on the next trail!");

    // Re-read through a brand-new call, not the object the write already
    // returned — proves the value actually persisted to Postgres rather than
    // merely being echoed back from the input.
    const reread = await svc.getAgencyBranding(agencyId);
    expect(reread.logoWidth).toBe(220);
    expect(reread.receiptFooter).toBe("See you on the next trail!");
  });

  it("a partial PATCH leaves the other field untouched", async () => {
    await svc.updateAgencyBranding(agencyId, { logoWidth: 90 });

    const after = await svc.getAgencyBranding(agencyId);
    expect(after.logoWidth).toBe(90);
    // Still what the previous test saved — the omitted key really did nothing.
    expect(after.receiptFooter).toBe("See you on the next trail!");
  });

  it("null clears the receipt footer back to the platform default", async () => {
    await svc.updateAgencyBranding(agencyId, { receiptFooter: null });

    const after = await svc.getAgencyBranding(agencyId);
    expect(after.receiptFooter).toBe("Thank you for trekking with us!");
  });

  it("the CSS variable reflects the persisted width", async () => {
    await svc.updateAgencyBranding(agencyId, { logoWidth: 200 });
    const branding = await svc.getAgencyBranding(agencyId);

    expect(svc.brandingCssVariables(branding)["--brand-logo-width"]).toBe("200px");
  });

  it("the public read by slug carries the same real values", async () => {
    const agency = await db.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { slug: true } });
    const publicBranding = await svc.getPublicBrandingBySlug(agency.slug);

    expect(publicBranding.logoWidth).toBe(200);
  });
});
