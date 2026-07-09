import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyAgency = vi.fn();
const findFirstAgency = vi.fn();
const groupByReview = vi.fn();
const aggregateReview = vi.fn();
const findManyDestination = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    agency: {
      findMany: (...a: unknown[]) => findManyAgency(...a),
      findFirst: (...a: unknown[]) => findFirstAgency(...a),
    },
    review: {
      groupBy: (...a: unknown[]) => groupByReview(...a),
      aggregate: (...a: unknown[]) => aggregateReview(...a),
    },
    trekDestination: {
      findMany: (...a: unknown[]) => findManyDestination(...a),
    },
  },
}));

import {
  listAgencies,
  getAgencyProfile,
  listDestinations,
  getDestinationBySlug,
  roundRating,
} from "../services/marketplaceDirectory.service.js";

beforeEach(() => {
  vi.clearAllMocks();
  groupByReview.mockResolvedValue([]);
});

describe("roundRating", () => {
  it("rounds to one decimal", () => {
    expect(roundRating(4.567)).toBe(4.6);
  });
  it("returns null for null/undefined", () => {
    expect(roundRating(null)).toBeNull();
    expect(roundRating(undefined)).toBeNull();
  });
});

describe("listAgencies", () => {
  const agencyRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "a1",
    name: "Himalaya Treks",
    slug: "himalaya-treks",
    priorityOverride: 0,
    tier: { name: "LARGE" },
    profile: { logo: "logo.png", description: "desc", regions: ["Everest"] },
    destinations: [{ name: "Everest", _count: { packages: 3 } }],
    ...over,
  });

  it("applies default pagination", async () => {
    findManyAgency.mockResolvedValue([agencyRow()]);
    const result = await listAgencies({});
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
    expect(result.meta.total).toBe(1);
  });

  it("caps limit at 100", async () => {
    findManyAgency.mockResolvedValue([]);
    const result = await listAgencies({ limit: 500 });
    expect(result.meta.limit).toBe(100);
  });

  it("passes tier and search into the Prisma where clause", async () => {
    findManyAgency.mockResolvedValue([]);
    await listAgencies({ tier: "LARGE", search: "everest" });
    const where = findManyAgency.mock.calls[0][0].where;
    expect(where.tier).toEqual({ name: "LARGE" });
    expect(where.OR).toBeDefined();
  });

  it("computes sponsored from priorityOverride", async () => {
    findManyAgency.mockResolvedValue([agencyRow({ priorityOverride: 30 })]);
    const result = await listAgencies({});
    expect(result.data[0].sponsored).toBe(true);
  });

  it("filters by region in application code", async () => {
    findManyAgency.mockResolvedValue([
      agencyRow({ id: "a1", profile: { logo: null, description: null, regions: ["Everest"] } }),
      agencyRow({ id: "a2", profile: { logo: null, description: null, regions: ["Annapurna"] } }),
    ]);
    const result = await listAgencies({ region: "Annapurna" });
    expect(result.data.map((a) => a.id)).toEqual(["a2"]);
  });

  it("filters by minRating using the joined review average", async () => {
    findManyAgency.mockResolvedValue([
      agencyRow({ id: "high" }),
      agencyRow({ id: "low" }),
    ]);
    groupByReview.mockResolvedValue([
      { agencyId: "high", _avg: { rating: 4.9 }, _count: { rating: 10 } },
      { agencyId: "low", _avg: { rating: 3.0 }, _count: { rating: 10 } },
    ]);
    const result = await listAgencies({ minRating: 4.5 });
    expect(result.data.map((a) => a.id)).toEqual(["high"]);
  });

  it("paginates the filtered result set", async () => {
    findManyAgency.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => agencyRow({ id: `a${i}`, name: `Agency ${i}` }))
    );
    const result = await listAgencies({ page: 2, limit: 10 });
    expect(result.meta.total).toBe(25);
    expect(result.meta.pages).toBe(3);
    expect(result.data.length).toBe(10);
  });
});

describe("getAgencyProfile", () => {
  it("returns null when the agency isn't found or isn't listable", async () => {
    findFirstAgency.mockResolvedValue(null);
    const result = await getAgencyProfile("missing");
    expect(result).toBeNull();
  });

  it("adds Sponsored badge when priorityOverride > 0", async () => {
    findFirstAgency.mockResolvedValue({
      id: "a1", name: "A", slug: "a", createdAt: new Date(),
      priorityOverride: 10, tier: { name: "LARGE" }, kyc: null,
      profile: null, packages: [], reviews: [],
    });
    aggregateReview.mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });
    const result = await getAgencyProfile("a") as { badges: string[] };
    expect(result.badges).toContain("Sponsored");
  });

  it("adds Verified badge only when KYC is APPROVED", async () => {
    findFirstAgency.mockResolvedValue({
      id: "a1", name: "A", slug: "a", createdAt: new Date(),
      priorityOverride: 0, tier: { name: "LARGE" }, kyc: { status: "APPROVED" },
      profile: null, packages: [], reviews: [],
    });
    aggregateReview.mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });
    const result = await getAgencyProfile("a") as { badges: string[] };
    expect(result.badges).toContain("Verified");
  });

  it("hides profile fields with ShowOnWebsite = false", async () => {
    findFirstAgency.mockResolvedValue({
      id: "a1", name: "A", slug: "a", createdAt: new Date(),
      priorityOverride: 0, tier: { name: "LARGE" }, kyc: null,
      profile: {
        logo: "logo.png", logoShowOnWebsite: false,
        description: "desc", descriptionShowOnWebsite: true,
        address: "addr", addressShowOnWebsite: true,
        phone: null, phoneShowOnWebsite: true,
        email: null, emailShowOnWebsite: true,
        regions: null, regionsShowOnWebsite: true,
      },
      packages: [], reviews: [],
    });
    aggregateReview.mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });
    const result = await getAgencyProfile("a") as { profile: { logo: string | null } };
    expect(result.profile.logo).toBeNull();
  });
});

describe("listDestinations", () => {
  it("groups per-agency destination rows into one master destination by slug", async () => {
    findManyDestination.mockResolvedValue([
      { name: "Everest Base Camp", region: "Khumbu", altitudeM: 5364, bestSeason: "Spring", agencyId: "a1", packages: [{ id: "p1" }] },
      { name: "Everest Base Camp", region: null, altitudeM: null, bestSeason: null, agencyId: "a2", packages: [{ id: "p2" }] },
    ]);
    const result = await listDestinations({});
    expect(result.data.length).toBe(1);
    expect(result.data[0].agencyCount).toBe(2);
    expect(result.data[0].packageCount).toBe(2);
    expect(result.data[0].region).toBe("Khumbu"); // backfilled from the first non-null row
  });

  it("filters by altitude range", async () => {
    findManyDestination.mockResolvedValue([
      { name: "Low Trek", region: null, altitudeM: 2000, bestSeason: null, agencyId: "a1", packages: [] },
      { name: "High Trek", region: null, altitudeM: 6000, bestSeason: null, agencyId: "a1", packages: [] },
    ]);
    const result = await listDestinations({ altitudeMin: 5000 });
    expect(result.data.map((d) => d.name)).toEqual(["High Trek"]);
  });

  it("paginates results", async () => {
    findManyDestination.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        name: `Dest ${i}`, region: null, altitudeM: null, bestSeason: null,
        agencyId: "a1", packages: [],
      }))
    );
    const result = await listDestinations({ page: 1, limit: 10 });
    expect(result.meta.total).toBe(15);
    expect(result.data.length).toBe(10);
  });
});

describe("getDestinationBySlug", () => {
  it("returns null when no listable agency has a matching destination", async () => {
    findManyDestination.mockResolvedValue([]);
    const result = await getDestinationBySlug("nowhere");
    expect(result).toBeNull();
  });

  it("aggregates agencies and drops ones with no published packages here", async () => {
    findManyDestination.mockResolvedValue([
      {
        name: "Everest Base Camp", region: "Khumbu", altitudeM: 5364, bestSeason: "Spring",
        agency: { id: "a1", name: "A1", slug: "a1", tier: { name: "LARGE" } },
        packages: [{ id: "p1", title: "T", slug: "t", durationDays: 10, pricePerPerson: "100", difficulty: "MODERATE", agencyId: "a1" }],
      },
      {
        name: "Everest Base Camp", region: null, altitudeM: null, bestSeason: null,
        agency: { id: "a2", name: "A2", slug: "a2", tier: { name: "SMALL" } },
        packages: [], // no published packages here → dropped
      },
    ]);
    const result = await getDestinationBySlug("everest-base-camp") as { agencies: unknown[]; agencyCount: number };
    expect(result.agencyCount).toBe(1);
    expect(result.agencies.length).toBe(1);
  });
});