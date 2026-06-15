import { describe, it, expect, vi, beforeEach } from "vitest";

// itinerary.service.ts imports `{ db } from "@funtush/database"`.
vi.mock("@funtush/database", () => {
  const client = {
    trekPackage: { findFirst: vi.fn() }, // used by assertPackageOwned
    trekItinerary: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { db: client, prisma: client };
});

import {
  addItineraryDayService,
  updateItineraryDayService,
  deleteItineraryDayService,
  reorderItineraryService,
} from "../src/services/itinerary.service";
import { db } from "@funtush/database";

// Helper: make assertPackageOwned pass (package belongs to the agency) or fail.
const ownPackage = () => vi.mocked(db.trekPackage.findFirst).mockResolvedValue({ id: "pkg_1" } as never);
const foreignPackage = () => vi.mocked(db.trekPackage.findFirst).mockResolvedValue(null);

beforeEach(() => vi.clearAllMocks());

describe("addItineraryDayService", () => {
  it("creates a day when the number is free", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.findFirst).mockResolvedValue(null); // no clash
    vi.mocked(db.trekItinerary.create).mockResolvedValue({ id: "it_1", dayNumber: 1 } as never);

    const result = await addItineraryDayService("agency_A", "pkg_1", { dayNumber: 1, location: "Lukla" });

    expect(vi.mocked(db.trekItinerary.create).mock.calls[0][0].data).toMatchObject({
      packageId: "pkg_1",
      dayNumber: 1,
      location: "Lukla",
    });
    expect(result.dayNumber).toBe(1);
  });

  it("rejects a duplicate day number", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.findFirst).mockResolvedValue({ id: "it_existing" } as never);
    await expect(
      addItineraryDayService("agency_A", "pkg_1", { dayNumber: 1 })
    ).rejects.toThrow("Day 1 already exists");
    expect(db.trekItinerary.create).not.toHaveBeenCalled();
  });

  it("throws 404 when the package is owned by another agency", async () => {
    foreignPackage();
    const err = await addItineraryDayService("agency_B", "pkg_1", { dayNumber: 1 }).catch((e) => e);
    expect(err.status).toBe(404);
  });

  it("rejects invalid input before any DB work", async () => {
    await expect(
      addItineraryDayService("agency_A", "pkg_1", { dayNumber: 0 })
    ).rejects.toThrow("dayNumber must be a positive integer");
    expect(db.trekPackage.findFirst).not.toHaveBeenCalled();
  });
});

describe("updateItineraryDayService", () => {
  it("updates only the supplied content fields", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.trekItinerary.findFirst).mockResolvedValue({ id: "it_1", location: "Namche" } as never);

    await updateItineraryDayService("agency_A", "pkg_1", 2, { location: "Namche" });

    const arg = vi.mocked(db.trekItinerary.updateMany).mock.calls[0][0];
    expect(arg.where).toEqual({ packageId: "pkg_1", dayNumber: 2 });
    expect(arg.data).toEqual({ location: "Namche" });
    expect(arg.data).not.toHaveProperty("dayNumber"); // dayNumber not editable here
  });

  it("throws 404 when the day does not exist (count 0)", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.updateMany).mockResolvedValue({ count: 0 } as never);
    const err = await updateItineraryDayService("agency_A", "pkg_1", 99, { location: "x" }).catch((e) => e);
    expect(err.status).toBe(404);
  });
});

describe("deleteItineraryDayService", () => {
  it("deletes the day and renumbers the days after it, in one transaction", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.findFirst).mockResolvedValue({ id: "it_2" } as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);
    vi.mocked(db.trekItinerary.findMany).mockResolvedValue([] as never);

    await deleteItineraryDayService("agency_A", "pkg_1", 2);

    // delete targets the resolved row id
    expect(vi.mocked(db.trekItinerary.delete).mock.calls[0][0]).toEqual({ where: { id: "it_2" } });
    // every later day shifts down by one
    expect(vi.mocked(db.trekItinerary.updateMany).mock.calls[0][0]).toEqual({
      where: { packageId: "pkg_1", dayNumber: { gt: 2 } },
      data: { dayNumber: { decrement: 1 } },
    });
    expect(db.$transaction).toHaveBeenCalledOnce(); // atomic
  });

  it("throws 404 when the day is missing", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.findFirst).mockResolvedValue(null);
    const err = await deleteItineraryDayService("agency_A", "pkg_1", 5).catch((e) => e);
    expect(err.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("reorderItineraryService", () => {
  const EXISTING = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("reassigns day numbers by array position", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.findMany)
      .mockResolvedValueOnce(EXISTING as never) // ids that exist
      .mockResolvedValueOnce([] as never); // final ordered read
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    await reorderItineraryService("agency_A", "pkg_1", ["c", "a", "b"]);

    const updates = vi.mocked(db.trekItinerary.update).mock.calls.map((c) => c[0]);
    expect(updates).toEqual([
      { where: { id: "c" }, data: { dayNumber: 1 } },
      { where: { id: "a" }, data: { dayNumber: 2 } },
      { where: { id: "b" }, data: { dayNumber: 3 } },
    ]);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("rejects an order missing a day", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.findMany).mockResolvedValue(EXISTING as never);
    await expect(reorderItineraryService("agency_A", "pkg_1", ["a", "b"])).rejects.toThrow(
      "every itinerary day exactly once"
    );
  });

  it("rejects an id from another package", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.findMany).mockResolvedValue(EXISTING as never);
    await expect(reorderItineraryService("agency_A", "pkg_1", ["a", "b", "z"])).rejects.toThrow(
      "does not belong to this package"
    );
  });

  it("rejects a duplicated id", async () => {
    ownPackage();
    vi.mocked(db.trekItinerary.findMany).mockResolvedValue(EXISTING as never);
    await expect(reorderItineraryService("agency_A", "pkg_1", ["a", "a", "b"])).rejects.toThrow("Duplicate");
  });

  it("rejects a non-array / empty order", async () => {
    ownPackage();
    await expect(reorderItineraryService("agency_A", "pkg_1", [])).rejects.toThrow("non-empty array");
  });
});
