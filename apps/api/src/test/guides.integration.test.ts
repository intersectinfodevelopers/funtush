// ─────────────────────────────────────────────────────────────────────────────
// Guides module — integration tests (Phase 2)
//
// Talks to a REAL Postgres (docker-compose.test.yml). Exercises the whole
// guides.service.ts stack against the DB, plus checks that the existing
// offlinePackage.loadGuideContact() keeps working after a soft-delete.
//
// SAFE anywhere: if no DB is reachable, every test skips. Each run uses its own
// throwaway agency so tests never collide or touch real data.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type GuidesService = typeof import("../services/guides.service");
type OfflineService = typeof import("../services/offlinePackage.service");

let DB_AVAILABLE = false;
let skipReason = "";

let db: Database["db"];
let svc: GuidesService;
let loadGuideContact: OfflineService["loadGuideContact"];

let tierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config(); // no-op if vitest.setup already loaded .env.test

  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;

  // Dedicated tier so the guide cap is predictable (maxGuides = 3).
  const tier = await db.subscriptionTier.upsert({
    where: { name: "GUIDE_TEST_TIER" },
    update: { maxGuides: 3 },
    create: {
      name: "GUIDE_TEST_TIER",
      maxStaff: 5,
      maxGuides: 3,
      monthlyPrice: 0,
      features: {},
    },
    select: { id: true },
  });
  tierId = tier.id;

  svc = await import("../services/guides.service");
  ({ loadGuideContact } = await import("../services/offlinePackage.service"));

  DB_AVAILABLE = true;
} catch (error) {
  skipReason = error instanceof Error ? error.message : String(error);
  console.warn(`[guides.integration] DB unavailable — skipping (${skipReason})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

let agencyId = "";

d("Guides module (real DB)", () => {
  beforeAll(async () => {
    const suffix = `${Date.now()}`;
    const agency = await db.agency.create({
      data: {
        name: `Guide Test Agency ${suffix}`,
        email: `guidetest-${suffix}@example.com`,
        slug: `guidetest-${suffix}`,
        tierId,
      },
    });
    agencyId = agency.id;
  });

  afterAll(async () => {
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
  });

  it("create → get → list round-trips in the frontend shape", async () => {
    const created = await svc.createGuide(agencyId, {
      name: "Pemba Sherpa",
      phone: "+977 9800000001",
      email: "pemba@example.com",
      languages: ["Nepali", "English"],
      status: "available",
      certifications: [
        { name: "Wilderness First Aid", number: "WFA-1", expiry: "2027-11-01" },
        { name: "Mountaineering L1", number: "MNT-1", expiry: "2028-06-15", issuingBody: "NMA" },
      ],
    });

    expect(created.id).toBeTruthy();
    expect(created.guideRef).toBe(created.id);
    expect(created.name).toBe("Pemba Sherpa");
    expect(created.status).toBe("available");
    expect(created.certifications).toHaveLength(2);
    expect(created.certifications[0].expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const one = await svc.getGuide(agencyId, created.id);
    expect(one.name).toBe("Pemba Sherpa");
    expect(one.totalTreks).toBe(0);
    expect(one.upcomingAssignments).toEqual([]);

    const list = await svc.listGuides(agencyId, {});
    expect(list.total).toBe(1);
    expect(list.guides[0].id).toBe(created.id);

    const filtered = await svc.listGuides(agencyId, { language: "English", status: "available" });
    expect(filtered.total).toBe(1);
    const none = await svc.listGuides(agencyId, { status: "on_trek" });
    expect(none.total).toBe(0);
  });

  it("update replaces the certification set and changes status", async () => {
    const g = (await svc.listGuides(agencyId, {})).guides[0];
    const updated = await svc.updateGuide(agencyId, g.id, {
      status: "on_trek",
      certifications: [{ name: "New Cert Only", number: "NC-1", expiry: "2029-01-01" }],
    });
    expect(updated.status).toBe("on_trek");
    expect(updated.certifications).toHaveLength(1);
    expect(updated.certifications[0].name).toBe("New Cert Only");
  });

  it("enforces the tier guide cap (maxGuides = 3)", async () => {
    // one already exists; add two more to reach the cap
    await svc.createGuide(agencyId, { name: "G2", phone: "+977 2" });
    await svc.createGuide(agencyId, { name: "G3", phone: "+977 3" });
    await expect(svc.createGuide(agencyId, { name: "G4", phone: "+977 4" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("soft-delete hides the guide from the API but keeps loadGuideContact working", async () => {
    const g = (await svc.listGuides(agencyId, {})).guides.find((x) => x.name === "Pemba Sherpa")!;
    await svc.deleteGuide(agencyId, g.id);

    // gone from the agency-facing API
    await expect(svc.getGuide(agencyId, g.id)).rejects.toMatchObject({ status: 404 });
    const list = await svc.listGuides(agencyId, {});
    expect(list.guides.some((x) => x.id === g.id)).toBe(false);

    // row still exists in the DB
    const row = await db.guideProfile.findUnique({ where: { id: g.id } });
    expect(row?.isActive).toBe(false);

    // loadGuideContact only returns active guides — so it now returns null,
    // which is the documented fallback behaviour.
    const contact = await loadGuideContact(agencyId, g.guideRef);
    expect(contact).toBeNull();
  });
});
