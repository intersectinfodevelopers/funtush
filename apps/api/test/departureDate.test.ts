import { describe, it, expect, vi, beforeEach } from "vitest";

// departureDate.service.ts imports `{ db } from "@funtush/database"`.
vi.mock("@funtush/database", () => {
  const client = {
    trekPackage: { findFirst: vi.fn() }, // assertPackageOwned
    trekDepartureDate: {
      findFirst: vi.fn(), // getOwnedDeparture
      findUnique: vi.fn(), // confirmSlotsForBooking
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    booking: { count: vi.fn() },
  };
  return { db: client, prisma: client };
});

import {
  addDepartureDateService,
  updateDepartureDateService,
  deleteDepartureDateService,
  confirmSlotsForBooking,
} from "../src/services/departureDate.service";
import { db } from "@funtush/database";

const ownPackage = () => vi.mocked(db.trekPackage.findFirst).mockResolvedValue({ id: "pkg_1" } as never);

// A future date string the validator will accept (it rejects past dates).
const FUTURE = "2030-10-01";

beforeEach(() => vi.clearAllMocks());

describe("addDepartureDateService", () => {
  it("creates a date with 0 booked slots, defaulting to AVAILABLE", async () => {
    ownPackage();
    vi.mocked(db.trekDepartureDate.create).mockResolvedValue({ id: "dep_1" } as never);

    await addDepartureDateService("agency_A", "pkg_1", { startDate: FUTURE, maxSlots: 10 });

    const data = vi.mocked(db.trekDepartureDate.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.bookedSlots).toBe(0);
    expect(data.status).toBe("AVAILABLE");
    expect(data.maxSlots).toBe(10);
  });

  it("honours an explicit GUARANTEED status", async () => {
    ownPackage();
    vi.mocked(db.trekDepartureDate.create).mockResolvedValue({ id: "dep_1" } as never);
    await addDepartureDateService("agency_A", "pkg_1", { startDate: FUTURE, maxSlots: 10, status: "GUARANTEED" });
    const data = vi.mocked(db.trekDepartureDate.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe("GUARANTEED");
  });

  it("rejects a past start date", async () => {
    await expect(
      addDepartureDateService("agency_A", "pkg_1", { startDate: "2000-01-01", maxSlots: 10 })
    ).rejects.toThrow("cannot be in the past");
  });
});

describe("updateDepartureDateService", () => {
  const departure = (over = {}) => ({
    id: "dep_1",
    packageId: "pkg_1",
    maxSlots: 10,
    bookedSlots: 4,
    status: "AVAILABLE",
    ...over,
  });

  it("refuses to drop maxSlots below seats already booked", async () => {
    ownPackage();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(departure({ bookedSlots: 5 }) as never);
    await expect(
      updateDepartureDateService("agency_A", "pkg_1", "dep_1", { maxSlots: 3 })
    ).rejects.toThrow("cannot be less than");
    expect(db.trekDepartureDate.update).not.toHaveBeenCalled();
  });

  it("refuses to mark a fully-booked date AVAILABLE", async () => {
    ownPackage();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(
      departure({ bookedSlots: 10, status: "FULL" }) as never
    );
    await expect(
      updateDepartureDateService("agency_A", "pkg_1", "dep_1", { status: "AVAILABLE" })
    ).rejects.toThrow("fully-booked");
  });

  it("auto-derives FULL when capacity drops to the booked count", async () => {
    ownPackage();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(departure({ bookedSlots: 6 }) as never);
    vi.mocked(db.trekDepartureDate.update).mockResolvedValue({} as never);

    await updateDepartureDateService("agency_A", "pkg_1", "dep_1", { maxSlots: 6 });

    const data = vi.mocked(db.trekDepartureDate.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe("FULL");
  });

  it("reopens a FULL date to AVAILABLE when capacity is increased", async () => {
    ownPackage();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue(
      departure({ bookedSlots: 10, maxSlots: 10, status: "FULL" }) as never
    );
    vi.mocked(db.trekDepartureDate.update).mockResolvedValue({} as never);

    await updateDepartureDateService("agency_A", "pkg_1", "dep_1", { maxSlots: 12 });

    const data = vi.mocked(db.trekDepartureDate.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe("AVAILABLE");
  });
});

describe("deleteDepartureDateService", () => {
  it("blocks deletion when bookings reference the date", async () => {
    ownPackage();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue({ id: "dep_1", packageId: "pkg_1" } as never);
    vi.mocked(db.booking.count).mockResolvedValue(2 as never);

    await expect(deleteDepartureDateService("agency_A", "pkg_1", "dep_1")).rejects.toThrow("2 booking(s)");
    expect(db.trekDepartureDate.delete).not.toHaveBeenCalled();
  });

  it("deletes a date with no bookings", async () => {
    ownPackage();
    vi.mocked(db.trekDepartureDate.findFirst).mockResolvedValue({ id: "dep_1", packageId: "pkg_1" } as never);
    vi.mocked(db.booking.count).mockResolvedValue(0 as never);
    vi.mocked(db.trekDepartureDate.delete).mockResolvedValue({} as never);

    const result = await deleteDepartureDateService("agency_A", "pkg_1", "dep_1");
    expect(db.trekDepartureDate.delete).toHaveBeenCalledWith({ where: { id: "dep_1" } });
    expect(result.success).toBe(true);
  });
});

describe("confirmSlotsForBooking (transactional slot booking)", () => {
  // The real call passes a Prisma transaction client; the mocked `db` stands in for it.
  it("books the seats and flips to FULL when it sells out", async () => {
    vi.mocked(db.trekDepartureDate.findUnique).mockResolvedValue({
      id: "dep_1",
      maxSlots: 10,
      bookedSlots: 8,
      status: "AVAILABLE",
    } as never);
    vi.mocked(db.trekDepartureDate.update).mockResolvedValue({} as never);

    await confirmSlotsForBooking(db as never, "dep_1", 2);

    const data = vi.mocked(db.trekDepartureDate.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.bookedSlots).toBe(10);
    expect(data.status).toBe("FULL");
  });

  it("throws when the date is already FULL", async () => {
    vi.mocked(db.trekDepartureDate.findUnique).mockResolvedValue({
      id: "dep_1",
      maxSlots: 10,
      bookedSlots: 10,
      status: "FULL",
    } as never);
    await expect(confirmSlotsForBooking(db as never, "dep_1", 1)).rejects.toThrow("full");
  });

  it("throws when the group is larger than the seats left", async () => {
    vi.mocked(db.trekDepartureDate.findUnique).mockResolvedValue({
      id: "dep_1",
      maxSlots: 10,
      bookedSlots: 8,
      status: "AVAILABLE",
    } as never);
    await expect(confirmSlotsForBooking(db as never, "dep_1", 3)).rejects.toThrow("Only 2 slot(s) available");
  });
});
