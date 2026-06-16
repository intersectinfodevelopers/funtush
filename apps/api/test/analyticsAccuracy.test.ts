import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Day 5 — Integration accuracy tests.
 * Verifies analytics, period filters, reports, and platform totals
 * all produce correct numbers from a known, controlled dataset.
 */

// ── Shared in-memory event store driven by the mongo mock ─────────────────────
const { store } = vi.hoisted(() => ({ store: { events: [] as Array<Record<string, unknown>> } }));

function makeFindMock() {
  return vi.fn((filter: Record<string, unknown> = {}) => {
    // Very small query engine: supports agency_id, event_type ($in / eq), timestamp range
    const match = (e: Record<string, unknown>) => {
      if (filter.agency_id && e.agency_id !== filter.agency_id) return false;
      if (filter.event_type) {
        const et = filter.event_type as { $in?: string[] } | string;
        if (typeof et === "string" && e.event_type !== et) return false;
        if (typeof et === "object" && et.$in && !et.$in.includes(e.event_type as string)) return false;
      }
      if (filter.timestamp) {
        const range = filter.timestamp as { $gte?: Date; $lte?: Date };
        const ts = new Date(e.timestamp as string).getTime();
        if (range.$gte && ts < range.$gte.getTime()) return false;
        if (range.$lte && ts > range.$lte.getTime()) return false;
      }
      return true;
    };
    const results = store.events.filter(match);
    const chain = {
      sort:    () => chain,
      limit:   () => chain,
      toArray: () => Promise.resolve(results),
    };
    return chain;
  });
}

const { findMock, countMock, aggregateMock } = vi.hoisted(() => ({
  findMock:      vi.fn(),
  countMock:     vi.fn(),
  aggregateMock: vi.fn(),
}));

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      find:           findMock,
      countDocuments: countMock,
      aggregate:      aggregateMock,
      insertOne:      vi.fn().mockResolvedValue({ insertedId: "x" }),
      updateOne:      vi.fn().mockResolvedValue({}),
      createIndex:    vi.fn().mockResolvedValue("ok"),
      distinct:       vi.fn().mockResolvedValue([]),
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

import {
  resolveDateRange,
  getOverviewAnalytics,
  getPackageAnalytics,
} from "../src/services/agencyAnalytics.service";
import { buildReportData, monthRange, toCSV } from "../src/services/report.service";

// Helper to seed known events
function seed(events: Array<Record<string, unknown>>) {
  store.events = events;
  findMock.mockImplementation(makeFindMock());
}

const AGENCY = "agency_known";

// ── 1. Analytics data accuracy with known bookings ─────────────────────────────
describe("Day 5 — analytics accuracy with known bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.events = [];
  });

  it("counts exactly the bookings created", async () => {
    seed([
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-05"), metadata: {} },
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "p1", trekker_id: "t2", timestamp: new Date("2024-03-06"), metadata: {} },
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "p2", trekker_id: "t3", timestamp: new Date("2024-03-07"), metadata: {} },
      { agency_id: AGENCY, event_type: "INQUIRY_SUBMITTED", package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-04"), metadata: {} },
    ]);

    const range = { from: new Date("2024-03-01"), to: new Date("2024-03-31") };
    const result = await getOverviewAnalytics(AGENCY, range, "last_30_days");
    expect(result.summary.totalBookings).toBe(3);
    expect(result.summary.totalInquiries).toBe(1);
  });

  it("sums revenue exactly from known paid events", async () => {
    seed([
      { agency_id: AGENCY, event_type: "BOOKING_PAID", package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-05"), metadata: { amount: 1200 } },
      { agency_id: AGENCY, event_type: "BOOKING_PAID", package_id: "p1", trekker_id: "t2", timestamp: new Date("2024-03-06"), metadata: { amount: 800  } },
      { agency_id: AGENCY, event_type: "BOOKING_PAID", package_id: "p2", trekker_id: "t3", timestamp: new Date("2024-03-07"), metadata: { amount: 3000 } },
    ]);

    const range = { from: new Date("2024-03-01"), to: new Date("2024-03-31") };
    const result = await getOverviewAnalytics(AGENCY, range, "last_30_days");
    expect(result.summary.totalRevenue).toBe(5000);
  });

  it("computes exact conversion rate from known data", async () => {
    seed([
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-05"), metadata: {} },
      { agency_id: AGENCY, event_type: "INQUIRY_SUBMITTED", package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-04"), metadata: {} },
      { agency_id: AGENCY, event_type: "INQUIRY_SUBMITTED", package_id: "p1", trekker_id: "t2", timestamp: new Date("2024-03-04"), metadata: {} },
      { agency_id: AGENCY, event_type: "INQUIRY_SUBMITTED", package_id: "p1", trekker_id: "t3", timestamp: new Date("2024-03-04"), metadata: {} },
      { agency_id: AGENCY, event_type: "INQUIRY_SUBMITTED", package_id: "p1", trekker_id: "t4", timestamp: new Date("2024-03-04"), metadata: {} },
    ]);
    // 1 confirmed / 4 inquiries = 25%
    const range = { from: new Date("2024-03-01"), to: new Date("2024-03-31") };
    const result = await getOverviewAnalytics(AGENCY, range, "last_30_days");
    expect(result.summary.conversionRate).toBe(25);
  });

  it("ranks top packages correctly by known bookings", async () => {
    seed([
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "everest", trekker_id: "t1", timestamp: new Date("2024-03-05"), metadata: {} },
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "everest", trekker_id: "t2", timestamp: new Date("2024-03-06"), metadata: {} },
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "everest", trekker_id: "t3", timestamp: new Date("2024-03-07"), metadata: {} },
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "annapurna", trekker_id: "t4", timestamp: new Date("2024-03-08"), metadata: {} },
    ]);
    const range = { from: new Date("2024-03-01"), to: new Date("2024-03-31") };
    const result = await getPackageAnalytics(AGENCY, range);
    expect(result.topByBookings[0].package_id).toBe("everest");
    expect(result.topByBookings[0].bookings).toBe(3);
  });
});

// ── 2. Period filters ──────────────────────────────────────────────────────────
describe("Day 5 — period filters work correctly", () => {
  it("last_7_days spans 7 days", () => {
    const { from, to } = resolveDateRange("last_7_days");
    const days = Math.round((to.getTime() - from.getTime()) / 86400000);
    expect(days).toBe(7);
  });

  it("last_30_days spans 30 days", () => {
    const { from, to } = resolveDateRange("last_30_days");
    const days = Math.round((to.getTime() - from.getTime()) / 86400000);
    expect(days).toBe(30);
  });

  it("custom period honours provided dates", () => {
    const { from, to } = resolveDateRange("custom", "2024-01-01", "2024-06-30");
    expect(from.toISOString().startsWith("2024-01-01")).toBe(true);
    expect(to.toISOString().startsWith("2024-06-30")).toBe(true);
  });

  it("filter excludes events outside the date range", async () => {
    vi.clearAllMocks();
    seed([
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-15"), metadata: {} }, // inside
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "p1", trekker_id: "t2", timestamp: new Date("2024-01-15"), metadata: {} }, // outside
    ]);
    const range = { from: new Date("2024-03-01"), to: new Date("2024-03-31") };
    const result = await getOverviewAnalytics(AGENCY, range, "last_30_days");
    expect(result.summary.totalBookings).toBe(1);
  });
});

// ── 3. Report generation returns correct file ──────────────────────────────────
describe("Day 5 — report generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.events = [];
  });

  it("monthly report contains correct totals from known data", async () => {
    seed([
      { agency_id: AGENCY, event_type: "BOOKING_CONFIRMED", package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-05"), metadata: { guide_id: "g1" } },
      { agency_id: AGENCY, event_type: "BOOKING_PAID",      package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-05"), metadata: { amount: 2500 } },
    ]);
    const range = monthRange("2024-03");
    const data  = await buildReportData(AGENCY, range, "March 2024");
    expect(data.summary.totalBookings).toBe(1);
    expect(data.summary.totalRevenue).toBe(2500);
    expect(data.periodLabel).toBe("March 2024");
  });

  it("CSV output contains the known revenue figure", async () => {
    seed([
      { agency_id: AGENCY, event_type: "BOOKING_PAID", package_id: "p1", trekker_id: "t1", timestamp: new Date("2024-03-05"), metadata: { amount: 9999 } },
    ]);
    const range = monthRange("2024-03");
    const data  = await buildReportData(AGENCY, range, "March 2024");
    const csv   = toCSV(data);
    expect(csv).toContain("Total Revenue,9999");
    expect(csv).toContain("SUMMARY");
  });
});
