import { describe, it, expect, vi, beforeEach } from "vitest";

// guides.service.ts imports `{ db, Prisma } from "@funtush/database"`.
vi.mock("@funtush/database", () => {
  const client = {
    guideProfile: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    guideCertification: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    agency: { findUnique: vi.fn() },
    booking: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };
  return { db: client, prisma: client, Prisma: {} };
});

import {
  listGuides,
  createGuide,
  updateGuide,
  deleteGuide,
  getGuide,
  GuideServiceError,
} from "../src/services/guides.service";
import { db } from "@funtush/database";

const AG = "agency_1";

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  guideRef: "g1",
  fullName: "Suresh Tamang",
  email: null,
  phone: "+977 9801",
  sex: null,
  photoUrl: null,
  bio: null,
  languages: ["Nepali", "English"],
  status: "AVAILABLE",
  rating: null,
  isActive: true,
  branchId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  certifications: [],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("createGuide", () => {
  it("rejects a missing name with 400", async () => {
    await expect(createGuide(AG, { phone: "123" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a missing phone with 400", async () => {
    await expect(createGuide(AG, { name: "Ann" })).rejects.toMatchObject({ status: 400 });
  });

  it("enforces the tier guide cap with 403", async () => {
    vi.mocked(db.agency.findUnique).mockResolvedValue({ tier: { maxGuides: 2 } } as never);
    vi.mocked(db.guideProfile.count).mockResolvedValue(2);

    await expect(createGuide(AG, { name: "Ann", phone: "123" })).rejects.toBeInstanceOf(
      GuideServiceError,
    );
    await expect(
      createGuide(AG, { name: "Ann", phone: "123" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.guideProfile.create).not.toHaveBeenCalled();
  });

  it("maps API shape → db columns and lowercases status back", async () => {
    vi.mocked(db.agency.findUnique).mockResolvedValue({ tier: { maxGuides: 10 } } as never);
    vi.mocked(db.guideProfile.count).mockResolvedValue(1);
    vi.mocked(db.guideProfile.create).mockImplementation(
      async (args: never) => dbRow({ status: "ON_TREK", fullName: "Karma", languages: ["Nepali"] }) as never,
    );

    const guide = await createGuide(AG, {
      name: "Karma",
      phone: "+977 555",
      photo: "/x.jpg",
      status: "on_trek",
      languages: ["Nepali"],
      certifications: [
        { name: "WFA", number: "W-1", expiry: "2027-01-01" },
        { name: "", number: "", expiry: "" }, // dropped
      ],
    });

    const createArg = vi.mocked(db.guideProfile.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data.fullName).toBe("Karma");
    expect(createArg.data.photoUrl).toBe("/x.jpg");
    expect(createArg.data.status).toBe("ON_TREK");
    expect(createArg.data.guideRef).toBe(createArg.data.id); // guideRef == id
    const certs = (createArg.data.certifications as { create: unknown[] }).create;
    expect(certs).toHaveLength(1); // blank cert filtered out

    expect(guide.status).toBe("on_trek");
    expect(guide.name).toBe("Karma");
  });
});

describe("updateGuide", () => {
  it("404s when the guide is not owned by the agency", async () => {
    vi.mocked(db.guideProfile.findFirst).mockResolvedValue(null);
    await expect(updateGuide(AG, "nope", { name: "X" })).rejects.toMatchObject({ status: 404 });
  });

  it("replaces the whole certification set when certifications are sent", async () => {
    vi.mocked(db.guideProfile.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(db.guideProfile.findUnique).mockResolvedValue(dbRow() as never);

    await updateGuide(AG, "g1", {
      certifications: [{ name: "New", number: "N-9", expiry: "2028-05-05" }],
    });

    expect(db.guideCertification.deleteMany).toHaveBeenCalledWith({
      where: { guideProfileId: "g1" },
    });
    expect(db.guideCertification.createMany).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(db.guideCertification.createMany).mock.calls[0][0].data as unknown[];
    expect(rows).toHaveLength(1);
  });

  it("does not touch certifications when they are omitted", async () => {
    vi.mocked(db.guideProfile.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(db.guideProfile.findUnique).mockResolvedValue(dbRow() as never);

    await updateGuide(AG, "g1", { status: "unavailable" });

    expect(db.guideCertification.deleteMany).not.toHaveBeenCalled();
    const updArg = vi.mocked(db.guideProfile.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updArg.data.status).toBe("UNAVAILABLE");
  });
});

describe("deleteGuide", () => {
  it("soft-deletes (isActive:false), not a hard delete", async () => {
    vi.mocked(db.guideProfile.findFirst).mockResolvedValue({ id: "g1" } as never);
    await deleteGuide(AG, "g1");
    expect(db.guideProfile.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { isActive: false },
    });
  });

  it("404s for an unknown guide", async () => {
    vi.mocked(db.guideProfile.findFirst).mockResolvedValue(null);
    await expect(deleteGuide(AG, "x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("listGuides", () => {
  it("filters by status + language and returns the frontend shape", async () => {
    vi.mocked(db.guideProfile.findMany).mockResolvedValue([
      dbRow({ certifications: [{ id: "c1", name: "WFA", issuingBody: null, number: "W-1", expiry: new Date("2026-11-01"), documentUrl: null }] }),
    ] as never);
    vi.mocked(db.guideProfile.count).mockResolvedValue(1);

    const out = await listGuides(AG, { status: "available", language: "English" });

    const whereArg = vi.mocked(db.guideProfile.findMany).mock.calls[0][0].where as Record<string, unknown>;
    expect(whereArg.status).toBe("AVAILABLE");
    expect(whereArg.languages).toEqual({ has: "English" });
    expect(whereArg.isActive).toBe(true);

    expect(out.total).toBe(1);
    expect(out.guides[0].name).toBe("Suresh Tamang");
    expect(out.guides[0].status).toBe("available");
    expect(out.guides[0].certifications[0].expiry).toBe("2026-11-01"); // YYYY-MM-DD
  });
});

describe("getGuide", () => {
  it("adds computed totalTreks + upcomingAssignments", async () => {
    vi.mocked(db.guideProfile.findFirst).mockResolvedValue(dbRow({ guideRef: "g1" }) as never);
    vi.mocked(db.booking.findMany).mockResolvedValue([
      {
        id: "bk1",
        status: "ACTIVE",
        departureDate: { startDate: new Date("2027-05-01") },
        package: { title: "EBC Trek" },
      },
    ] as never);
    vi.mocked(db.booking.count).mockResolvedValue(4);

    const guide = await getGuide(AG, "g1");
    expect(guide.totalTreks).toBe(4);
    expect(guide.upcomingAssignments).toEqual([
      { id: "bk1", title: "EBC Trek", date: new Date("2027-05-01"), status: "ACTIVE" },
    ]);
  });
});
