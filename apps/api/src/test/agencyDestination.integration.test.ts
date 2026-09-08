// Agency Destinations — integration test (Phase 2). Real DB, skip if down.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/agencyDestination.service");

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
    where: { name: "DEST_TEST_TIER" },
    update: {},
    create: { name: "DEST_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/agencyDestination.service");
  DB_AVAILABLE = true;
} catch (e) {
  console.warn(`[agencyDestination.integration] skip (${e instanceof Error ? e.message : e})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";

d("Agency Destinations (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    const a = await db.agency.create({
      data: { name: `Dest ${s}`, email: `dest-${s}@example.com`, slug: `dest-${s}`, tierId },
    });
    agencyId = a.id;
  });
  afterAll(async () => {
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
  });

  it("create → publish/feature → list filters → delete", async () => {
    const created = await svc.createDestination(agencyId, {
      title: "Everest Base Camp",
      region: "Khumbu",
      difficulty: "Hard",
      altitudeMax: "5,364m",
      bestSeason: "Autumn/Spring",
      activities: ["Trekking", "Photography"],
      shortDescription: "The classic.",
    });
    expect(created.slug).toBe("everest-base-camp");
    expect(created.published).toBe(false);
    expect(created.altitude.max).toBe(5364);

    // not in published-only list yet
    expect((await svc.listDestinations(agencyId, { published: "true" })).total).toBe(0);

    const pub = await svc.updateDestination(agencyId, created.id, { published: true, featured: true });
    expect(pub.published).toBe(true);
    expect(pub.featured).toBe(true);

    expect((await svc.listDestinations(agencyId, { published: "true" })).total).toBe(1);
    expect((await svc.listDestinations(agencyId, { featured: "true" })).total).toBe(1);
    expect((await svc.listDestinations(agencyId, { search: "khumbu" })).total).toBe(1);

    await svc.deleteDestination(agencyId, created.id);
    await expect(svc.getDestination(agencyId, created.id)).rejects.toMatchObject({ status: 404 });
  });

  it("slug collisions get suffixed", async () => {
    const a = await svc.createDestination(agencyId, { title: "Annapurna" });
    const b = await svc.createDestination(agencyId, { title: "Annapurna" });
    expect(a.slug).toBe("annapurna");
    expect(b.slug).toBe("annapurna-2");
  });
});
