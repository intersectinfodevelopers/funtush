// ─────────────────────────────────────────────────────────────────────────────
// Marketplace ranking — integration tests
//
// Real Postgres (docker-compose.test.yml). Proves the two headline behaviours
// of marketplaceRanking.service end to end:
//   1. the KYC gate — an unverified agency never ranks
//   2. personalisation — an agency the trekker completed a trek with lands in
//      `trekkedWith` with a `yourHistory` summary
//
// SAFE anywhere: skips if no DB. Throwaway fixtures per run.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Service = typeof import("../services/marketplaceRanking.service");

let DB_AVAILABLE = false;
let skipReason = "";
let db: Database["db"];
let svc: Service;
let tierId = "";

const ids = {
  agencyV: "",
  agencyU: "",
  userV: "",
  trekkerUserId: "",
  trekkerId: "",
};

const S = `${Date.now()}`;

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;

  const tier = await db.subscriptionTier.upsert({
    where: { name: "MKT_RANK_TEST_TIER" },
    update: {},
    create: { name: "MKT_RANK_TEST_TIER", maxStaff: 5, maxGuides: 3, monthlyPrice: 49, features: {} },
    select: { id: true },
  });
  tierId = tier.id;

  async function makeAgency(label: string, kyc: "APPROVED" | "SUBMITTED") {
    const lc = label.toLowerCase();
    const agency = await db.agency.create({
      data: {
        name: `RankTest ${label} ${S}`,
        email: `rank-${lc}-${S}@example.com`,
        slug: `rank-${lc}-${S}`,
        tierId,
        status: "ACTIVE",
        profile: { create: { logo: "l.png", description: "desc", regions: ["Everest Region"] } },
        kyc: { create: { status: kyc } },
      },
      select: { id: true },
    });
    const pkg = await db.trekPackage.create({
      data: {
        agencyId: agency.id,
        title: `Pkg ${lc}`,
        slug: `pkg-${lc}-${S}`,
        durationDays: 10,
        pricePerPerson: 1200,
        maxGroupSize: 12,
        difficulty: "MODERATE",
        status: "PUBLISHED",
        destinations: { create: { name: "Everest Region", agencyId: agency.id } },
      },
      select: { id: true, destinations: { select: { id: true } } },
    });
    const dep = await db.trekDepartureDate.create({
      data: { packageId: pkg.id, startDate: new Date("2026-06-01"), maxSlots: 10, bookedSlots: 0 },
      select: { id: true },
    });
    return { agencyId: agency.id, packageId: pkg.id, departureDateId: dep.id };
  }

  const v = await makeAgency("V", "APPROVED");
  const u = await makeAgency("U", "SUBMITTED");
  ids.agencyV = v.agencyId;
  ids.agencyU = u.agencyId;

  const trekUser = await db.user.create({
    data: { email: `rank-trek-${S}@example.com`, passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
    select: { id: true },
  });
  ids.trekkerUserId = trekUser.id;
  const trekker = await db.trekker.create({ data: { userId: trekUser.id, fullName: "Rank Trekker" }, select: { id: true } });
  ids.trekkerId = trekker.id;

  // Completed booking with the VERIFIED agency.
  await db.booking.create({
    data: {
      agencyId: v.agencyId,
      trekkerId: trekker.id,
      packageId: v.packageId,
      departureDateId: v.departureDateId,
      status: "COMPLETED",
      groupSize: 1,
      totalPrice: 1200,
      trekkerName: "Rank Trekker",
      trekkerEmail: `rank-trek-${S}@example.com`,
      trekkerPhone: "+1 555 0100",
    },
  });

  svc = await import("../services/marketplaceRanking.service");
  DB_AVAILABLE = true;
} catch (error) {
  skipReason = error instanceof Error ? error.message : String(error);
  console.warn(`[marketplaceRanking.integration] DB unavailable — skipping (${skipReason})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;

d("Marketplace ranking (real DB)", () => {
  afterAll(async () => {
    const agencyIds = [ids.agencyV, ids.agencyU].filter(Boolean);
    await db.booking.deleteMany({ where: { agencyId: { in: agencyIds } } }).catch(() => {});
    await db.review.deleteMany({ where: { agencyId: { in: agencyIds } } }).catch(() => {});
    for (const id of agencyIds) await db.agency.delete({ where: { id } }).catch(() => {});
    if (ids.trekkerUserId) await db.user.delete({ where: { id: ids.trekkerUserId } }).catch(() => {});
  });

  it("ranks the KYC-verified agency and excludes the unverified one", async () => {
    const result = await svc.rankAgencies({ trekkerId: null, filters: { search: S } });
    const slugs = [...result.trekkedWith, ...result.recommended].map((a) => a.slug);
    expect(slugs).toContain(`rank-v-${S}`);
    expect(slugs).not.toContain(`rank-u-${S}`);
    expect(result.meta.personalised).toBe(false);
  });

  it("every ranked agency carries the Verified badge (the gate guarantees KYC)", async () => {
    const { recommended, trekkedWith } = await svc.rankAgencies({ trekkerId: null, filters: { search: S } });
    for (const a of [...recommended, ...trekkedWith]) {
      expect(a.badges).toContain("Verified");
    }
  });

  it("floats a completed-with agency into trekkedWith with history", async () => {
    const result = await svc.rankAgencies({ trekkerId: ids.trekkerUserId, filters: { search: S } });
    expect(result.meta.personalised).toBe(true);
    expect(result.trekkedWith.map((a) => a.slug)).toEqual([`rank-v-${S}`]);
    const v = result.trekkedWith[0];
    expect(v.relationship).toBe("trekked-with");
    expect(v.yourHistory).toMatchObject({ completedCount: 1, bookingCount: 1 });
    expect(v.yourHistory?.lastTrek?.status).toBe("COMPLETED");
    expect(v.reasons[0]).toMatch(/completed 1 trek with them/);
  });

  it("compareAgencies returns the picked agencies in order, unverified included", async () => {
    const rows = await svc.compareAgencies([`rank-u-${S}`, `rank-v-${S}`], ids.trekkerUserId);
    expect(rows.map((r) => r.slug)).toEqual([`rank-u-${S}`, `rank-v-${S}`]);
    expect(rows.find((r) => r.slug === `rank-u-${S}`)?.verified).toBe(false);
    expect(rows.find((r) => r.slug === `rank-v-${S}`)?.verified).toBe(true);
    expect(rows.find((r) => r.slug === `rank-v-${S}`)?.yourHistory?.completedCount).toBe(1);
  });

  it("compareAgencies rejects fewer than 2 agencies", async () => {
    await expect(svc.compareAgencies([`rank-v-${S}`])).rejects.toMatchObject({ status: 400 });
  });
});
