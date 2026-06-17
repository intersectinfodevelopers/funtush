import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Mocks ───────────────────────────────────────────────────────────────── */
// A single fake index object whose methods we can assert against.
const fakeIndex = {
  updateSettings: vi.fn().mockResolvedValue({ taskUid: 1 }),
  addDocuments: vi.fn().mockResolvedValue({ taskUid: 2 }),
  deleteDocument: vi.fn().mockResolvedValue({ taskUid: 3 }),
  search: vi.fn().mockResolvedValue({ hits: [] }),
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
const findUniqueTrekker = vi.fn();
const findManyBooking = vi.fn();
vi.mock("@funtush/database", () => ({
  db: {
    trekPackage: { findUnique: (...a: unknown[]) => findUniquePackage(...a) },
    agency: { findUnique: (...a: unknown[]) => findUniqueAgency(...a) },
    trekker: { findUnique: (...a: unknown[]) => findUniqueTrekker(...a) },
    booking: { findMany: (...a: unknown[]) => findManyBooking(...a) },
  },
}));

import {
  toPackageDocument,
  toAgencyDocument,
  configureIndexes,
  indexPackage,
  removePackage,
  searchMarketplacePackages,
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
    agency: { name: "Himalaya Treks", tier: { name: "LARGE" } },
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

  it("maps the agency tier and its marketplace weight", () => {
    expect(toPackageDocument(base).tier).toBe("LARGE");
    expect(toPackageDocument(base).tierWeight).toBe(100);
  });

  it("defaults a missing tier to SMALL weight", () => {
    const doc = toPackageDocument({ ...base, agency: { name: "X" } });
    expect(doc.tier).toBe("SMALL");
    expect(doc.tierWeight).toBe(20);
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

/* ── Marketplace search ──────────────────────────────────────────────────── */
describe("searchMarketplacePackages", () => {
  // helper: a minimal hit as Meili would return it
  const hit = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "p", agencyId: "a", agencyName: "A", title: "t", description: "",
    destination: [], season: [], difficulty: "EASY", price: 100, duration: 5,
    altitude: 0, status: "PUBLISHED", slug: "t", tier: "SMALL", tierWeight: 20,
    createdAt: 1000, _rankingScore: 1, ...over,
  });

  it("always filters to published, non-FREE packages", async () => {
    fakeIndex.search.mockResolvedValueOnce({ hits: [] });
    await searchMarketplacePackages({});
    const filter = fakeIndex.search.mock.calls[0][1].filter;
    expect(filter).toContain('status = "PUBLISHED"');
    expect(filter).toContain('tier != "FREE"');
  });

  it("translates difficulty / price / season filters into a Meili filter string", async () => {
    fakeIndex.search.mockResolvedValueOnce({ hits: [] });
    await searchMarketplacePackages({
      q: "everest",
      filters: { difficulty: "MODERATE", priceMax: 1500, season: "Spring" },
    });
    const [query, opts] = fakeIndex.search.mock.calls[0];
    expect(query).toBe("everest");
    expect(opts.filter).toContain('difficulty = "MODERATE"');
    expect(opts.filter).toContain("price <= 1500");
    expect(opts.filter).toContain('season = "Spring"');
  });

  it("ranks higher tiers above lower tiers when relevance is equal", async () => {
    fakeIndex.search.mockResolvedValueOnce({
      hits: [
        hit({ id: "small", agencyId: "s", tier: "SMALL", tierWeight: 20 }),
        hit({ id: "large", agencyId: "l", tier: "LARGE", tierWeight: 100 }),
      ],
    });
    const { data } = await searchMarketplacePackages({});
    expect(data.map((d) => d.id)).toEqual(["large", "small"]);
    // transient Meili field is stripped from the response
    expect((data[0] as unknown as Record<string, unknown>)._rankingScore).toBeUndefined();
  });

  it("boosts agencies the logged-in trekker booked before", async () => {
    findUniqueTrekker.mockResolvedValue({ id: "trk-1" });
    findManyBooking.mockResolvedValue([{ agencyId: "fav" }]);
    // two equal-tier packages: the one from a previously-booked agency wins
    fakeIndex.search.mockResolvedValueOnce({
      hits: [
        hit({ id: "stranger", agencyId: "other" }),
        hit({ id: "favourite", agencyId: "fav" }),
      ],
    });
    const { data } = await searchMarketplacePackages({ trekkerUserId: "user-1" });
    expect(data.map((d) => d.id)).toEqual(["favourite", "stranger"]);
  });

  it("does not personalize for anonymous (no token) requests", async () => {
    fakeIndex.search.mockResolvedValueOnce({ hits: [] });
    await searchMarketplacePackages({});
    expect(findManyBooking).not.toHaveBeenCalled();
  });

  it("paginates and reports meta.total / meta.pages", async () => {
    fakeIndex.search.mockResolvedValueOnce({
      hits: Array.from({ length: 25 }, (_, i) => hit({ id: `p${i}`, createdAt: i })),
    });
    const { data, meta } = await searchMarketplacePackages({ page: 2, limit: 10 });
    expect(meta.total).toBe(25);
    expect(meta.pages).toBe(3);
    expect(meta.page).toBe(2);
    expect(data.length).toBe(10);
  });
});
