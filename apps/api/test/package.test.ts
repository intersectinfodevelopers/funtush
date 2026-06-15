import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB package the service imports ──────────────────────────────────
// package.service.ts does `import { db } from "@funtush/database"`. vi.mock is
// hoisted above the imports, so the service receives THIS fake client. `db` and
// `prisma` point at the same object, mirroring the real module (db = prisma).
vi.mock("@funtush/database", () => {
  const client = {
    trekPackage: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { db: client, prisma: client };
});

import {
  createPackageService,
  updatePackageService,
  listPackagesService,
  publishPackageService,
  duplicatePackageService,
  archivePackageService,
} from "../src/services/package.service";
import { db } from "@funtush/database";

// A package that passes every publish completeness check.
const COMPLETE_PKG = {
  id: "pkg_1",
  agencyId: "agency_A",
  title: "Everest Base Camp",
  description: "A classic trek to the foot of Everest.",
  pricePerPerson: 1200,
  status: "DRAFT",
  itineraries: [{ id: "it_1", dayNumber: 1 }],
  departureDates: [{ id: "dep_1", startDate: new Date("2026-10-01") }],
};

const VALID_INPUT = {
  title: "Everest Base Camp",
  description: "A classic trek.",
  durationDays: 14,
  pricePerPerson: 1200,
  difficulty: "MODERATE" as const,
  maxGroupSize: 12,
};

beforeEach(() => vi.clearAllMocks());

describe("createPackageService", () => {
  it("creates a DRAFT scoped to the caller's agency", async () => {
    vi.mocked(db.trekPackage.findUnique).mockResolvedValue(null); // slug is free
    vi.mocked(db.trekPackage.create).mockResolvedValue({ id: "pkg_1", status: "DRAFT" } as never);

    const result = await createPackageService("agency_A", VALID_INPUT);

    const createArg = vi.mocked(db.trekPackage.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(createArg.agencyId).toBe("agency_A"); // tenant owner comes from the arg, not the body
    expect(createArg.status).toBeUndefined(); // omitted → Prisma default DRAFT
    expect(createArg.slug).toBe("everest-base-camp");
    expect(result).toMatchObject({ id: "pkg_1", status: "DRAFT" });
  });

  it("rejects invalid input before touching the DB", async () => {
    await expect(
      createPackageService("agency_A", { ...VALID_INPUT, title: "" })
    ).rejects.toThrow("title is required");
    expect(db.trekPackage.create).not.toHaveBeenCalled();
  });

  it("appends a counter when the derived slug already exists", async () => {
    vi.mocked(db.trekPackage.findUnique)
      .mockResolvedValueOnce({ id: "existing" } as never) // base slug taken
      .mockResolvedValueOnce(null); // "-2" is free
    vi.mocked(db.trekPackage.create).mockResolvedValue({ id: "pkg_2" } as never);

    await createPackageService("agency_A", VALID_INPUT);

    const createArg = vi.mocked(db.trekPackage.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(createArg.slug).toBe("everest-base-camp-2");
  });
});

describe("updatePackageService", () => {
  it("updates only the supplied fields, scoped by id AND agencyId", async () => {
    vi.mocked(db.trekPackage.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.trekPackage.findUnique).mockResolvedValue({ id: "pkg_1", title: "New" } as never);

    await updatePackageService("agency_A", "pkg_1", { title: "New" });

    const arg = vi.mocked(db.trekPackage.updateMany).mock.calls[0][0];
    expect(arg.where).toEqual({ id: "pkg_1", agencyId: "agency_A" }); // tenant isolation
    expect(arg.data).toEqual({ title: "New" }); // no untouched fields leak in
    expect(arg.data).not.toHaveProperty("status"); // status is not editable here
  });

  it("throws 404 when the package belongs to another agency (count 0)", async () => {
    vi.mocked(db.trekPackage.updateMany).mockResolvedValue({ count: 0 } as never);
    const err = await updatePackageService("agency_B", "pkg_1", { title: "X" }).catch((e) => e);
    expect(err.message).toBe("Package not found");
    expect(err.status).toBe(404);
  });

  it("throws when no updatable fields are provided", async () => {
    await expect(updatePackageService("agency_A", "pkg_1", {})).rejects.toThrow("No fields provided");
  });
});

describe("listPackagesService", () => {
  it("always scopes the query to the caller's agency", async () => {
    vi.mocked(db.trekPackage.findMany).mockResolvedValue([] as never);
    await listPackagesService("agency_A", {});
    const where = vi.mocked(db.trekPackage.findMany).mock.calls[0][0].where as Record<string, unknown>;
    expect(where.agencyId).toBe("agency_A");
  });

  it("passes status and destination filters through", async () => {
    vi.mocked(db.trekPackage.findMany).mockResolvedValue([] as never);
    await listPackagesService("agency_A", { status: "PUBLISHED", destination: "Everest" });
    const where = vi.mocked(db.trekPackage.findMany).mock.calls[0][0].where as Record<string, unknown>;
    expect(where.status).toBe("PUBLISHED");
    expect(where.destinations).toEqual({ some: { name: { equals: "Everest", mode: "insensitive" } } });
  });
});

describe("publishPackageService", () => {
  it("flips a complete package to PUBLISHED", async () => {
    vi.mocked(db.trekPackage.findFirst).mockResolvedValue(COMPLETE_PKG as never);
    vi.mocked(db.trekPackage.update).mockResolvedValue({ ...COMPLETE_PKG, status: "PUBLISHED" } as never);

    const result = await publishPackageService("agency_A", "pkg_1");

    expect(vi.mocked(db.trekPackage.update).mock.calls[0][0].data).toEqual({ status: "PUBLISHED" });
    expect(result.status).toBe("PUBLISHED");
  });

  it("throws 404 when the package isn't owned by the agency", async () => {
    vi.mocked(db.trekPackage.findFirst).mockResolvedValue(null);
    const err = await publishPackageService("agency_B", "pkg_1").catch((e) => e);
    expect(err.status).toBe(404);
  });

  it("refuses to publish an archived package", async () => {
    vi.mocked(db.trekPackage.findFirst).mockResolvedValue({ ...COMPLETE_PKG, status: "ARCHIVED" } as never);
    await expect(publishPackageService("agency_A", "pkg_1")).rejects.toThrow("archived");
    expect(db.trekPackage.update).not.toHaveBeenCalled();
  });

  it("lists every missing requirement, not just the first", async () => {
    vi.mocked(db.trekPackage.findFirst).mockResolvedValue({
      id: "pkg_1",
      agencyId: "agency_A",
      title: "",
      description: "",
      pricePerPerson: 0,
      status: "DRAFT",
      itineraries: [],
      departureDates: [],
    } as never);

    const err = await publishPackageService("agency_A", "pkg_1").catch((e) => e);
    expect(err.message).toContain("title");
    expect(err.message).toContain("description");
    expect(err.message).toContain("price");
    expect(err.message).toContain("itinerary");
    expect(err.message).toContain("departure date");
    expect(db.trekPackage.update).not.toHaveBeenCalled();
  });
});

describe("duplicatePackageService", () => {
  it("clones as DRAFT and resets departure-date bookings", async () => {
    vi.mocked(db.trekPackage.findFirst).mockResolvedValue({
      ...COMPLETE_PKG,
      status: "PUBLISHED",
      durationDays: 14,
      pricePerPerson: 1200,
      difficulty: "MODERATE",
      maxGroupSize: 12,
      itineraries: [{ dayNumber: 1, location: "Lukla", description: "", altitudeM: 2860 }],
      departureDates: [{ startDate: new Date("2026-10-01"), maxSlots: 10, bookedSlots: 7, status: "FULL" }],
      addOns: [],
      destinations: [{ id: "dest_1" }],
    } as never);
    vi.mocked(db.trekPackage.findUnique).mockResolvedValue(null); // clone slug free
    vi.mocked(db.trekPackage.create).mockResolvedValue({ id: "pkg_clone", status: "DRAFT" } as never);

    await duplicatePackageService("agency_A", "pkg_1");

    const data = vi.mocked(db.trekPackage.create).mock.calls[0][0].data as {
      status: string;
      title: string;
      departureDates: { create: { bookedSlots: number; status: string }[] };
      destinations: { connect: { id: string }[] };
    };
    expect(data.status).toBe("DRAFT"); // never inherits PUBLISHED
    expect(data.title).toBe("Copy of Everest Base Camp");
    expect(data.departureDates.create[0].bookedSlots).toBe(0); // bookings reset
    expect(data.departureDates.create[0].status).toBe("AVAILABLE");
    expect(data.destinations.connect).toEqual([{ id: "dest_1" }]); // connected, not duplicated
  });

  it("throws 404 when the source package isn't owned", async () => {
    vi.mocked(db.trekPackage.findFirst).mockResolvedValue(null);
    const err = await duplicatePackageService("agency_B", "pkg_1").catch((e) => e);
    expect(err.status).toBe(404);
  });
});

describe("archivePackageService", () => {
  it("sets status ARCHIVED scoped by id AND agencyId", async () => {
    vi.mocked(db.trekPackage.updateMany).mockResolvedValue({ count: 1 } as never);
    const result = await archivePackageService("agency_A", "pkg_1");
    const arg = vi.mocked(db.trekPackage.updateMany).mock.calls[0][0];
    expect(arg.where).toEqual({ id: "pkg_1", agencyId: "agency_A" });
    expect(arg.data).toEqual({ status: "ARCHIVED" });
    expect(result.success).toBe(true);
  });

  it("throws 404 for another agency's package", async () => {
    vi.mocked(db.trekPackage.updateMany).mockResolvedValue({ count: 0 } as never);
    const err = await archivePackageService("agency_B", "pkg_1").catch((e) => e);
    expect(err.status).toBe(404);
  });
});
