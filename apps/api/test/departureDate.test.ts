import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the database package my service imports `db` from ─────────────────────
vi.mock("@funtush/database", () => ({
  db: {
    trekPackage: { findFirst: vi.fn() },
    trekDepartureDate: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    booking: { count: vi.fn() },
  },
}));

import { db } from "@funtush/database";
import {
  addDepartureDateService,
  updateDepartureDateService,
  deleteDepartureDateService,
  confirmSlotsForBooking,
} from "../src/services/departureDate.service";

const AGENCY = "agency_1";
const PKG = "pkg_1";
const DATE = "date_1";
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

// `db` is the mock; grab strongly-typed handles to its fns.
const owned = () => vi.mocked(db.trekPackage.findFirst).mockResolvedValue({ id: PKG } as never);
const notOwned = () => vi.mocked(db.trekPackage.findFirst).mockResolvedValue(null as never);

describe("Departure dates — tenant isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects creating a date on a package the agency does not own (404)", async () => {
    notOwned();
    await expect(addDepartureDateService(AGENCY, PKG, { startDate: FUTURE, maxSlots: 10 }))
      .rejects.toMatchObject({ message: "Package not found", status: 404 });
    expect(db.trekDepartureDate.create).not.toHaveBeenCalled();
  });

  it("creates a date with bookedSlots=0 and AVAILABLE by default", async () => {
    owned();
    vi.mocked(db.trekDepartureDate.create).mockResolvedValue({ id: DATE } as never);
    await addDepartureDateService(AGENCY, PKG, { startDate: FUTURE, maxSlots: 12 });
    const arg = vi.mocked(db.trekDepartureDate.create).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({ packageId: PKG, maxSlots: 12, bookedSlots: 0, status: "AVAILABLE" });
  });

  it("rejects a past startDate", async () => {
    owned();
    await expect(addDepartureDateService(AGENCY, PKG, { startDate: "2000-01-01", maxSlots: 5 }))
      .rejects.toThrow(/past/);
  });
});

describe("Departure dates — update guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("won't shrink maxSlots below seats already booked", async () => {
    owned();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(
      { id: DATE, packageId: PKG, maxSlots: 10, bookedSlots: 6, status: "AVAILABLE" } as never
    );
    await expect(updateDepartureDateService(AGENCY, PKG, DATE, { maxSlots: 4 }))
      .rejects.toThrow(/cannot be less than the 6/);
    expect(db.trekDepartureDate.update).not.toHaveBeenCalled();
  });

  it("auto-derives FULL when capacity is reduced down to booked count", async () => {
    owned();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(
      { id: DATE, packageId: PKG, maxSlots: 10, bookedSlots: 6, status: "AVAILABLE" } as never
    );
    vi.mocked(db.trekDepartureDate.update).mockResolvedValue({} as never);
    await updateDepartureDateService(AGENCY, PKG, DATE, { maxSlots: 6 });
    const arg = vi.mocked(db.trekDepartureDate.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({ maxSlots: 6, status: "FULL" });
  });

  it("won't let a sold-out date be marked AVAILABLE", async () => {
    owned();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(
      { id: DATE, packageId: PKG, maxSlots: 10, bookedSlots: 10, status: "FULL" } as never
    );
    await expect(updateDepartureDateService(AGENCY, PKG, DATE, { status: "AVAILABLE" }))
      .rejects.toThrow(/fully-booked/);
  });
});

describe("Departure dates — delete guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("won't delete a date that has bookings", async () => {
    owned();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(
      { id: DATE, packageId: PKG, maxSlots: 10, bookedSlots: 2, status: "AVAILABLE" } as never
    );
    vi.mocked(db.booking.count).mockResolvedValue(2 as never);
    await expect(deleteDepartureDateService(AGENCY, PKG, DATE)).rejects.toThrow(/2 booking/);
    expect(db.trekDepartureDate.delete).not.toHaveBeenCalled();
  });

  it("deletes a date with no bookings", async () => {
    owned();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(
      { id: DATE, packageId: PKG, maxSlots: 10, bookedSlots: 0, status: "AVAILABLE" } as never
    );
    vi.mocked(db.booking.count).mockResolvedValue(0 as never);
    vi.mocked(db.trekDepartureDate.delete).mockResolvedValue({} as never);
    const res = await deleteDepartureDateService(AGENCY, PKG, DATE);
    expect(res).toMatchObject({ success: true });
  });
});

describe("confirmSlotsForBooking — prevents overbooking", () => {
  // A throwaway transaction-client mock with just the two methods the helper uses.
  const makeTx = (departure: Record<string, unknown> | null) => {
    const update = vi.fn().mockResolvedValue({});
    return {
      tx: {
        trekDepartureDate: {
          findUnique: vi.fn().mockResolvedValue(departure),
          update,
        },
      },
      update,
    };
  };

  it("books groupSize seats and stays AVAILABLE when capacity remains", async () => {
    const { tx, update } = makeTx({ id: DATE, maxSlots: 10, bookedSlots: 2, status: "AVAILABLE" });
    await confirmSlotsForBooking(tx as never, DATE, 3);
    expect(update.mock.calls[0][0].data).toMatchObject({ bookedSlots: 5, status: "AVAILABLE" });
  });

  it("flips to FULL once booked_slots reaches max_slots", async () => {
    const { tx, update } = makeTx({ id: DATE, maxSlots: 10, bookedSlots: 7, status: "AVAILABLE" });
    await confirmSlotsForBooking(tx as never, DATE, 3);
    expect(update.mock.calls[0][0].data).toMatchObject({ bookedSlots: 10, status: "FULL" });
  });

  it("rejects a confirmation that would exceed capacity", async () => {
    const { tx, update } = makeTx({ id: DATE, maxSlots: 10, bookedSlots: 8, status: "AVAILABLE" });
    await expect(confirmSlotsForBooking(tx as never, DATE, 3)).rejects.toThrow(/Only 2 slot/);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects confirming against an already-FULL date", async () => {
    const { tx } = makeTx({ id: DATE, maxSlots: 10, bookedSlots: 10, status: "FULL" });
    await expect(confirmSlotsForBooking(tx as never, DATE, 1)).rejects.toThrow(/full/);
  });
});
