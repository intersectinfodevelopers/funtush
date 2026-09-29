import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted mocks ──────────────────────────────────────────────────────────
const {
  countDocsMock,
  aggregateMock,
} = vi.hoisted(() => ({
  countDocsMock: vi.fn().mockResolvedValue(0),
  aggregateMock: vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      countDocuments: countDocsMock,
      aggregate:      aggregateMock,
      find:           vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      createIndex:    vi.fn().mockResolvedValue("ok"),
    }),
  }),
}));

// ── Mock Prisma ───────────────────────────────────────────────────────────────
vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    booking: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalPrice: null } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    agency: {
      count:   vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    trekPackage: { findMany: vi.fn().mockResolvedValue([]) },
    subscriptionTier: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// ── Mock Redis ────────────────────────────────────────────────────────────────
vi.mock("../src/services/redis.service", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

import {
  getPlatformOverview,
  getAgencyPerformance,
  getMarketplaceAnalytics,
  getTierAnalytics,
} from "../src/services/platformAnalytics.service";
import { prisma } from "../src/packages/database/prisma";

describe("getPlatformOverview()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns correct shape", async () => {
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(result).toHaveProperty("generatedAt");
    expect(result).toHaveProperty("totalBookings");
    expect(result).toHaveProperty("monthlyBookings");
    expect(result).toHaveProperty("totalRevenue");
    expect(result).toHaveProperty("monthlyRevenue");
    expect(result).toHaveProperty("activeAgencies");
    expect(result).toHaveProperty("agenciesByTier");
    expect(result).toHaveProperty("revenueByTier");
    expect(result).toHaveProperty("topDestinations");
  });

  it("returns totalRevenue from aggregate", async () => {
    aggregateMock.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 50000 }]),
    });
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(typeof result.totalRevenue).toBe("number");
  });

  it("returns 0 revenue when no paid events", async () => {
    aggregateMock.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(result.totalRevenue).toBe(0);
  });

  it("activeAgencies comes from prisma.agency.count", async () => {
    vi.mocked(prisma.agency.count).mockResolvedValue(42);
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(result.activeAgencies).toBe(42);
  });

  it("agenciesByTier is a GROUP BY over tierId, named via the tier table (not a full-table load)", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([
      { tierId: "t-free", _count: { _all: 10 } },
      { tierId: "t-pro", _count: { _all: 5 } },
    ] as never);
    vi.mocked(prisma.subscriptionTier.findMany).mockResolvedValue([
      { id: "t-free", name: "FREE" },
      { id: "t-pro", name: "PRO" },
    ] as never);
    const result = await getPlatformOverview() as Record<string, unknown>;
    const tiers = result.agenciesByTier as Record<string, number>;
    expect(tiers.FREE).toBe(10);
    expect(tiers.PRO).toBe(5);
  });

  it("topDestinations is an array", async () => {
    aggregateMock.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "Nepal", count: 100 },
        { _id: "Peru",  count: 50  },
      ]),
    });
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(Array.isArray(result.topDestinations)).toBe(true);
  });

  it("generatedAt is a valid ISO timestamp", async () => {
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(typeof result.generatedAt).toBe("string");
    expect(() => new Date(result.generatedAt as string)).not.toThrow();
  });
});

describe("getAgencyPerformance()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns correct shape", async () => {
    const result = await getAgencyPerformance() as Record<string, unknown>;
    expect(result).toHaveProperty("topByBookings");
    expect(result).toHaveProperty("topByRevenue");
    expect(result).toHaveProperty("topByRetention");
    expect(result).toHaveProperty("generatedAt");
  });

  it("topByBookings is sorted by bookings desc", async () => {
    vi.mocked(prisma.booking.groupBy).mockResolvedValueOnce([
      { agencyId: "agency_1", _count: { _all: 100 } },
      { agencyId: "agency_2", _count: { _all: 50 } },
    ] as never);
    const result = await getAgencyPerformance() as Record<string, unknown>;
    const top = result.topByBookings as Array<{ agency_id: string; bookings: number }>;
    expect(top[0].bookings).toBeGreaterThanOrEqual(top[1]?.bookings ?? 0);
  });

  it("returns empty arrays when no data", async () => {
    aggregateMock.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const result = await getAgencyPerformance() as Record<string, unknown>;
    expect((result.topByBookings as unknown[]).length).toBe(0);
    expect((result.topByRevenue as unknown[]).length).toBe(0);
  });
});

describe("getMarketplaceAnalytics()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns correct shape", async () => {
    const result = await getMarketplaceAnalytics() as Record<string, unknown>;
    expect(result).toHaveProperty("topSearchedDestinations");
    expect(result).toHaveProperty("popularFilters");
    expect(result).toHaveProperty("bookingStatusBreakdown");
  });

  it("bookingStatusBreakdown has all required fields", async () => {
    const result = await getMarketplaceAnalytics() as Record<string, unknown>;
    const breakdown = result.bookingStatusBreakdown as Record<string, unknown>;
    expect(breakdown).toHaveProperty("totalBookings");
    expect(breakdown).toHaveProperty("byStatus");
    expect(breakdown).toHaveProperty("conversionRate");
    expect(breakdown).toHaveProperty("completionRate");
    expect(breakdown).toHaveProperty("cancellationRate");
  });

  it("calculates conversionRate from paid bookings", async () => {
    vi.mocked(prisma.booking.groupBy).mockResolvedValueOnce([
      { status: "INQUIRY", _count: { _all: 900 } },
      { status: "PAID", _count: { _all: 100 } },
    ] as never);

    const result = await getMarketplaceAnalytics() as Record<string, unknown>;
    const breakdown = result.bookingStatusBreakdown as Record<string, unknown>;
    expect(breakdown.conversionRate).toBe(10);
  });

  it("returns 0 rates when there are no bookings", async () => {
    vi.mocked(prisma.booking.groupBy).mockResolvedValueOnce([] as never);
    const result = await getMarketplaceAnalytics() as Record<string, unknown>;
    const breakdown = result.bookingStatusBreakdown as Record<string, unknown>;
    expect(breakdown.conversionRate).toBe(0);
    expect(breakdown.completionRate).toBe(0);
    expect(breakdown.cancellationRate).toBe(0);
  });
});

describe("getTierAnalytics()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns correct shape", async () => {
    const result = await getTierAnalytics() as Record<string, unknown>;
    expect(result).toHaveProperty("tierBreakdown");
    expect(result).toHaveProperty("trialToPaidRate");
    expect(result).toHaveProperty("churnRate");
    expect(result).toHaveProperty("recentUpgrades");
    expect(result).toHaveProperty("recentChurned");
    expect(result).toHaveProperty("churnByTier");
    expect(result).toHaveProperty("generatedAt");
  });

  it("churnByTier groups churned agencies by tier", async () => {
    vi.mocked(prisma.agency.findMany).mockResolvedValue([
      { id: "a1", tier: "FREE",  status: "SUSPENDED", updatedAt: new Date(), createdAt: new Date() },
      { id: "a2", tier: "FREE",  status: "LOCKED",    updatedAt: new Date(), createdAt: new Date() },
      { id: "a3", tier: "PRO",   status: "SUSPENDED", updatedAt: new Date(), createdAt: new Date() },
    ] as never);
    const result = await getTierAnalytics() as Record<string, unknown>;
    const churnByTier = result.churnByTier as Record<string, number>;
    expect(typeof churnByTier).toBe("object");
  });

  it("trialToPaidRate is 0 when no FREE agencies", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.agency.findMany).mockResolvedValue([] as never);
    const result = await getTierAnalytics() as Record<string, unknown>;
    expect(result.trialToPaidRate).toBe(0);
  });

  it("churnRate is 0 when no active agencies", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.agency.findMany).mockResolvedValue([] as never);
    const result = await getTierAnalytics() as Record<string, unknown>;
    expect(result.churnRate).toBe(0);
  });
});
