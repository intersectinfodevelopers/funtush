// ─────────────────────────────────────────────────────────────────────────────
// Departure slot booking — integration tests (real Postgres).
//
// confirmSlotsForBooking / releaseSlotsForBooking are the overbooking guard.
// confirmSlotsForBooking is now a single atomic conditional UPDATE, so the key
// test here is CONCURRENCY: N transactions racing for the last seats — exactly
// the ones that fit may succeed, and booked_slots never exceeds max_slots.
//
// Skips when no DB is reachable. Uses a throwaway agency + package.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type Svc = typeof import("../services/departureDate.service");

let DB = false;
let db: Database["db"];
let confirmSlotsForBooking: Svc["confirmSlotsForBooking"];
let releaseSlotsForBooking: Svc["releaseSlotsForBooking"];
let tierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;
  const tier = await db.subscriptionTier.upsert({
    where: { name: "SLOTS_TEST_TIER" },
    update: {},
    create: { name: "SLOTS_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  ({ confirmSlotsForBooking, releaseSlotsForBooking } = await import("../services/departureDate.service"));
  DB = true;
} catch (err) {
  console.warn(`[departureSlots.integration] DB unavailable — skipping (${err instanceof Error ? err.message : err})`);
}

const d = DB ? describe : describe.skip;

d("Departure slot booking (real DB)", () => {
  let agencyId = "";
  let packageId = "";

  beforeAll(async () => {
    const s = `${Date.now()}`;
    const agency = await db.agency.create({
      data: { name: `Slots ${s}`, email: `slots-${s}@example.com`, slug: `slots-${s}`, tierId },
      select: { id: true },
    });
    agencyId = agency.id;
    const pkg = await db.trekPackage.create({
      data: {
        agencyId, title: `Slots Trek ${s}`, slug: `slots-trek-${s}`,
        durationDays: 7, pricePerPerson: 500, difficulty: "MODERATE", maxGroupSize: 20, status: "PUBLISHED",
      },
      select: { id: true },
    });
    packageId = pkg.id;
  });
  afterAll(async () => {
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
  });

  const mkDeparture = (maxSlots: number, bookedSlots = 0, status: "AVAILABLE" | "GUARANTEED" = "AVAILABLE") =>
    db.trekDepartureDate.create({
      data: { packageId, startDate: new Date(Date.now() + 30 * 86400_000), maxSlots, bookedSlots, status },
      select: { id: true },
    });

  it("books seats and flips to FULL exactly at capacity", async () => {
    const dep = await mkDeparture(5, 3);
    await db.$transaction((tx) => confirmSlotsForBooking(tx, dep.id, 2));
    const after = await db.trekDepartureDate.findUnique({ where: { id: dep.id } });
    expect(after!.bookedSlots).toBe(5);
    expect(after!.status).toBe("FULL");
  });

  it("stays AVAILABLE below capacity and preserves GUARANTEED", async () => {
    const a = await mkDeparture(10, 2);
    await db.$transaction((tx) => confirmSlotsForBooking(tx, a.id, 3));
    expect((await db.trekDepartureDate.findUnique({ where: { id: a.id } }))!.status).toBe("AVAILABLE");

    const g = await mkDeparture(10, 1, "GUARANTEED");
    await db.$transaction((tx) => confirmSlotsForBooking(tx, g.id, 1));
    const gAfter = await db.trekDepartureDate.findUnique({ where: { id: g.id } });
    expect(gAfter!.bookedSlots).toBe(2);
    expect(gAfter!.status).toBe("GUARANTEED");
  });

  it("rejects a group that would exceed capacity, leaving counts untouched", async () => {
    const dep = await mkDeparture(5, 4);
    await expect(db.$transaction((tx) => confirmSlotsForBooking(tx, dep.id, 2))).rejects.toThrow(/slot/i);
    expect((await db.trekDepartureDate.findUnique({ where: { id: dep.id } }))!.bookedSlots).toBe(4);
  });

  it("CONCURRENCY: 10 groups of 3 race for 12 seats — exactly 4 win, no overbooking", async () => {
    const dep = await mkDeparture(12, 0);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        db.$transaction((tx) => confirmSlotsForBooking(tx, dep.id, 3)),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    expect(ok).toBe(4); // 4 * 3 = 12
    expect(failed).toBe(6);

    const after = await db.trekDepartureDate.findUnique({ where: { id: dep.id } });
    expect(after!.bookedSlots).toBe(12);
    expect(after!.bookedSlots).toBeLessThanOrEqual(after!.maxSlots);
    expect(after!.status).toBe("FULL");
  });

  it("releaseSlotsForBooking frees seats and re-opens a FULL date", async () => {
    const dep = await mkDeparture(4, 4, "AVAILABLE"); // starts FULL-by-count
    await db.trekDepartureDate.update({ where: { id: dep.id }, data: { status: "FULL" } });
    await db.$transaction((tx) => releaseSlotsForBooking(tx, dep.id, 2));
    const after = await db.trekDepartureDate.findUnique({ where: { id: dep.id } });
    expect(after!.bookedSlots).toBe(2);
    expect(after!.status).toBe("AVAILABLE");
  });

  it("releaseSlotsForBooking never drives booked_slots negative", async () => {
    const dep = await mkDeparture(10, 1);
    await db.$transaction((tx) => releaseSlotsForBooking(tx, dep.id, 5));
    expect((await db.trekDepartureDate.findUnique({ where: { id: dep.id } }))!.bookedSlots).toBe(0);
  });
});
