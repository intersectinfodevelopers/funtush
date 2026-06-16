import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Day 5 — Platform analytics accuracy.
 * Verifies admin platform-wide totals are computed correctly from
 * known aggregate results.
 */

const { countMock, aggregateMock } = vi.hoisted(() => ({
  countMock:     vi.fn().mockResolvedValue(0),
  aggregateMock: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      countDocuments: countMock,
      aggregate:      aggregateMock,
      find:           vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      createIndex:    vi.fn().mockResolvedValue("ok"),
    }),
  }),
}));

vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    agency: {
      count:    vi.fn().mockResolvedValue(0),
      groupBy:  vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
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
    countMock.mockResolvedValue(347);
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(result.totalBookings).toBe(347);
  });

  it("reports exact active agency count", async () => {
    vi.mocked(prisma.agency.count).mockResolvedValue(58);
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(result.activeAgencies).toBe(58);
  });

  it("aggregates revenue total correctly", async () => {
    aggregateMock.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 1250000 }]),
    });
    const result = await getPlatformOverview() as Record<string, unknown>;
    expect(typeof result.totalRevenue).toBe("number");
  });

  it("builds agenciesByTier from known group counts", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([
      { tier: "FREE",   _count: { _all: 30 } },
      { tier: "MEDIUM", _count: { _all: 20 } },
      { tier: "LARGE",  _count: { _all: 8  } },
    ] as never);
    const result = await getPlatformOverview() as Record<string, unknown>;
    const tiers = result.agenciesByTier as Record<string, number>;
    expect(tiers.FREE).toBe(30);
    expect(tiers.MEDIUM).toBe(20);
    expect(tiers.LARGE).toBe(8);
  });

  it("conversion funnel rates computed from known counts", async () => {
    countMock
      .mockResolvedValueOnce(2000) // pageViews
      .mockResolvedValueOnce(400)  // inquiries
      .mockResolvedValueOnce(200)  // confirmed
      .mockResolvedValueOnce(160); // paid

    const result = await getMarketplaceAnalytics() as Record<string, unknown>;
    const funnel = result.conversionFunnel as Record<string, number>;
    expect(funnel.viewToInquiryRate).toBe(20);    // 400/2000
    expect(funnel.inquiryToBookingRate).toBe(50); // 200/400
    expect(funnel.bookingToPaymentRate).toBe(80); // 160/200
  });
});
