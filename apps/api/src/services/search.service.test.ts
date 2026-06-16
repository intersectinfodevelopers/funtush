import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Mocks ───────────────────────────────────────────────────────────────── */
// A single fake index object whose methods we can assert against.
const fakeIndex = {
  updateSettings: vi.fn().mockResolvedValue({ taskUid: 1 }),
  addDocuments: vi.fn().mockResolvedValue({ taskUid: 2 }),
  deleteDocument: vi.fn().mockResolvedValue({ taskUid: 3 }),
};

const fakeMeili = {
  createIndex: vi.fn().mockResolvedValue({ taskUid: 0 }),
  index: vi.fn(() => fakeIndex),
};

vi.mock("../lib/meilisearch.js", () => ({
  isSearchEnabled: () => true,
  getMeili: () => fakeMeili,
}));

// db is only used by indexPackage/indexAgency; default to "not found".
const findUniquePackage = vi.fn();
const findUniqueAgency = vi.fn();
vi.mock("@funtush/database", () => ({
  db: {
    trekPackage: { findUnique: (...a: unknown[]) => findUniquePackage(...a) },
    agency: { findUnique: (...a: unknown[]) => findUniqueAgency(...a) },
  },
}));

import {
  toPackageDocument,
  toAgencyDocument,
  configureIndexes,
  indexPackage,
  removePackage,
  PACKAGE_INDEX,
  AGENCY_INDEX,
} from "./search.service.js";
import { getMeili } from "../lib/meilisearch.js";

const meili = getMeili();

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── Mappers ─────────────────────────────────────────────────────────────── */
describe("toPackageDocument", () => {
  const base = {
    id: "pkg-1",
    agencyId: "ag-1",
    title: "Everest Base Camp",
    slug: "everest-base-camp",
    description: "A classic trek",
    durationDays: 14,
    pricePerPerson: "1450.00", // Prisma Decimal serializes as string
    difficulty: "CHALLENGING",
    status: "PUBLISHED",
    createdAt: new Date("2026-06-16T00:00:00.000Z"),
    agency: { name: "Himalaya Treks" },
    destinations: [
      { name: "Everest", bestSeason: "Spring", altitudeM: 5364 },
      { name: "Khumbu", bestSeason: "Spring", altitudeM: 3440 },
    ],
    itineraries: [{ altitudeM: 5550 }, { altitudeM: 4000 }],
  };

  it("flattens relations and coerces types", () => {
    const doc = toPackageDocument(base);
    expect(doc.agencyName).toBe("Himalaya Treks");
    expect(doc.destination).toEqual(["Everest", "Khumbu"]);
    expect(doc.price).toBe(1450);
    expect(typeof doc.price).toBe("number");
    expect(doc.duration).toBe(14);
    expect(doc.createdAt).toBe(Math.floor(base.createdAt.getTime() / 1000));
  });

  it("takes the highest altitude across destinations and itinerary days", () => {
    expect(toPackageDocument(base).altitude).toBe(5550);
  });

  it("dedupes seasons and drops nulls", () => {
    const doc = toPackageDocument({
      ...base,
      itineraries: [],
      destinations: [
        { name: "A", bestSeason: "Spring", altitudeM: null },
        { name: "B", bestSeason: null, altitudeM: null },
        { name: "C", bestSeason: "Spring", altitudeM: null },
      ],
    });
    expect(doc.season).toEqual(["Spring"]);
    expect(doc.altitude).toBe(0); // no altitudes known → 0
  });

  it("handles a null description", () => {
    expect(toPackageDocument({ ...base, description: null }).description).toBe("");
  });
});

describe("toAgencyDocument", () => {
  const base = {
    id: "ag-1",
    name: "Himalaya Treks",
    slug: "himalaya-treks",
    status: "ACTIVE",
    tier: { name: "Large" },
    profile: { description: "Best in Nepal", regions: ["Everest", "Annapurna"] },
    destinations: [{ name: "Everest" }],
  };

  it("maps tier, description, destinations and array regions", () => {
    const doc = toAgencyDocument(base);
    expect(doc.tier).toBe("Large");
    expect(doc.description).toBe("Best in Nepal");
    expect(doc.region).toEqual(["Everest", "Annapurna"]);
    expect(doc.destinations).toEqual(["Everest"]);
    expect(doc.rating).toBe(0);
  });

  it("normalizes a string region to a single-element array", () => {
    expect(toAgencyDocument({ ...base, profile: { description: null, regions: "Everest" } }).region).toEqual([
      "Everest",
    ]);
  });

  it("handles a missing profile", () => {
    const doc = toAgencyDocument({ ...base, profile: null });
    expect(doc.description).toBe("");
    expect(doc.region).toEqual([]);
  });
});

/* ── Index configuration ─────────────────────────────────────────────────── */
describe("configureIndexes", () => {
  it("creates both indexes and applies typo tolerance + attribute settings", async () => {
    await configureIndexes();

    expect(meili.createIndex).toHaveBeenCalledWith(PACKAGE_INDEX, { primaryKey: "id" });
    expect(meili.createIndex).toHaveBeenCalledWith(AGENCY_INDEX, { primaryKey: "id" });

    const settingsCalls = fakeIndex.updateSettings.mock.calls.map((c) => c[0]);
    const pkgSettings = settingsCalls[0];
    const agencySettings = settingsCalls[1];

    expect(pkgSettings.searchableAttributes).toEqual(["title", "description", "destination", "agencyName"]);
    expect(pkgSettings.filterableAttributes).toEqual(
      expect.arrayContaining(["difficulty", "price", "duration", "season", "altitude"])
    );
    expect(pkgSettings.typoTolerance.enabled).toBe(true);

    expect(agencySettings.searchableAttributes).toEqual(["name", "description", "destinations"]);
    expect(agencySettings.filterableAttributes).toEqual(expect.arrayContaining(["tier", "region", "rating"]));
    expect(agencySettings.typoTolerance.enabled).toBe(true);
  });
});

/* ── Sync helpers ────────────────────────────────────────────────────────── */
describe("indexPackage / removePackage", () => {
  it("adds the mapped document when the package exists", async () => {
    findUniquePackage.mockResolvedValue({
      id: "pkg-1",
      agencyId: "ag-1",
      title: "T",
      slug: "t",
      description: "d",
      durationDays: 5,
      pricePerPerson: "100",
      difficulty: "EASY",
      status: "PUBLISHED",
      createdAt: new Date(),
      agency: { name: "A" },
      destinations: [],
      itineraries: [],
    });

    await indexPackage("pkg-1");

    expect(fakeIndex.addDocuments).toHaveBeenCalledTimes(1);
    expect(fakeIndex.addDocuments.mock.calls[0][0][0].id).toBe("pkg-1");
  });

  it("does nothing when the package is missing", async () => {
    findUniquePackage.mockResolvedValue(null);
    await indexPackage("missing");
    expect(fakeIndex.addDocuments).not.toHaveBeenCalled();
  });

  it("removePackage deletes by id", async () => {
    await removePackage("pkg-1");
    expect(fakeIndex.deleteDocument).toHaveBeenCalledWith("pkg-1");
  });
});
