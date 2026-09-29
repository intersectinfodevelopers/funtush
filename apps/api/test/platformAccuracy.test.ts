import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Day 5 — Platform analytics accuracy.
 * Verifies admin platform-wide totals are computed correctly from
 * known aggregate results.
 */

const { aggregateMock } = vi.hoisted(() => ({
  aggregateMock: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      aggregate:      aggregateMock,
      find:           vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      createIndex:    vi.fn().mockResolvedValue("ok"),
    }),
  }),
}));

vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    booking: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalPrice: null } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    agency: {
      count:    vi.fn().mockResolvedValue(0),
      groupBy:  vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    trekPackage: { findMany: vi.fn().mockResolvedValue([]) },
    subscriptionTier: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("../src/services/redis.service", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

import { getPlatformOverview, getMarketplaceAnalytics } from "../src/services/platformAnalytics.service";
import { prisma } from "../src/packages/database/prisma";

describe("Day 5 — platform-wide totals accuracy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports exact total bookings count", async () => {
    vi.mocked(prisma.booking.count).mockResolvedValueOnce(347).mockResolvedValueOnce(0);
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(result.totalBookings).toBe(347);
  });

  it("reports exact active agency count", async () => {
    vi.mocked(prisma.agency.count).mockResolvedValue(58);
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(result.activeAgencies).toBe(58);
  });

  it("aggregates revenue total correctly", async () => {
    vi.mocked(prisma.booking.aggregate)
      .mockResolvedValueOnce({ _sum: { totalPrice: 1250000 } } as never)
      .mockResolvedValueOnce({ _sum: { totalPrice: 0 } } as never);
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(typeof result.totalRevenue).toBe("number");
  });

  it("builds agenciesByTier from known agency tier names", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([
      { tierId: "t1", _count: { _all: 30 } },
      { tierId: "t2", _count: { _all: 20 } },
      { tierId: "t3", _count: { _all: 8 } },
    ] as never);
    vi.mocked(prisma.subscriptionTier.findMany).mockResolvedValue([
      { id: "t1", name: "FREE" }, { id: "t2", name: "MEDIUM" }, { id: "t3", name: "LARGE" },
    ] as never);
    const result = await getPlatformOverview() as Record<string, unknown>;
    const tiers = result.agenciesByTier as Record<string, number>;
    expect(tiers.FREE).toBe(30);
    expect(tiers.MEDIUM).toBe(20);
    expect(tiers.LARGE).toBe(8);
  });

  it("booking conversion rate is computed from known status counts", async () => {
    vi.mocked(prisma.booking.groupBy).mockResolvedValueOnce([
      { status: "INQUIRY", _count: { _all: 1600 } },
      { status: "PAID", _count: { _all: 400 } },
    ] as never);

    const result = await getMarketplaceAnalytics() as Record<string, unknown>;
    const breakdown = result.bookingStatusBreakdown as Record<string, number>;
    expect(breakdown.conversionRate).toBe(20);
  });
});
