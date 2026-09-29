import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted mocks
const { findMock } = vi.hoisted(() => ({
  findMock: vi.fn().mockReturnValue({
    sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    toArray: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      find:           findMock,
      insertOne:      vi.fn().mockResolvedValue({ insertedId: "x" }),
      updateOne:      vi.fn().mockResolvedValue({}),
      countDocuments: vi.fn().mockResolvedValue(0),
      createIndex:    vi.fn().mockResolvedValue("ok"),
      distinct:       vi.fn().mockResolvedValue([]),
    }),
  }),
}));

vi.mock("@funtush/database", () => ({
  db: { booking: { findMany: vi.fn() } },
}));

import { db } from "@funtush/database";
import {
  resolveDateRange,
  getOverviewAnalytics,
  getPackageAnalytics,
  getCustomerAnalytics,
  getGuideAnalytics,
  getOriginPackagePerformance,
} from "../src/services/agencyAnalytics.service";

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  agency_id:  "agency_xyz",
  event_type: "BOOKING_CONFIRMED",
  trekker_id: "trekker_1",
  package_id: "pkg_1",
  timestamp:  new Date("2024-01-15T10:00:00Z"),
  metadata:   { amount: 1000, guide_id: "guide_1", country: "Nepal" },
  ...overrides,
});

describe("resolveDateRange()", () => {
  it("last_7_days returns 7-day range", () => {
    const { from, to } = resolveDateRange("last_7_days");
    const diffDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(7);
  });

  it("last_30_days returns 30-day range", () => {
    const { from, to } = resolveDateRange("last_30_days");
    const diffDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  it("last_12_months sets from to start of month 12 months ago", () => {
    const { from } = resolveDateRange("last_12_months");
    expect(from.getDate()).toBe(1);
    expect(from.getHours()).toBe(0);
  });

  it("custom period uses provided from/to", () => {
    const { from, to } = resolveDateRange("custom", "2024-01-01", "2024-01-31");
    expect(from.toISOString().startsWith("2024-01-01")).toBe(true);
    expect(to.toISOString().startsWith("2024-01-31")).toBe(true);
  });

  it("custom period throws if from/to missing", () => {
    expect(() => resolveDateRange("custom")).toThrow("from and to");
  });
});

describe("getOverviewAnalytics()", () => {
  beforeEach(() => vi.clearAllMocks());

  const range = { from: new Date("2024-01-01"), to: new Date("2024-01-31") };

  it("returns correct shape", async () => {
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      toArray: vi.fn().mockResolvedValue([]),
    });
    const result = await getOverviewAnalytics("agency_xyz", range, "last_30_days");
    expect(result).toHaveProperty("period");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("charts");
    expect(result.charts).toHaveProperty("bookingsByDay");
    expect(result.charts).toHaveProperty("revenueByDay");
  });

  it("calculates totalRevenue from BOOKING_PAID events", async () => {
    const paidEvents = [
      makeEvent({ event_type: "BOOKING_PAID", metadata: { amount: 2000 } }),
      makeEvent({ event_type: "BOOKING_PAID", metadata: { amount: 3000 } }),
    ];
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(paidEvents) }),
      toArray: vi.fn().mockResolvedValue(paidEvents),
    });
    const result = await getOverviewAnalytics("agency_xyz", range, "last_30_days");
    expect(result.summary.totalRevenue).toBe(5000);
  });

  it("calculates conversionRate correctly", async () => {
    const events = [
      makeEvent({ event_type: "BOOKING_CONFIRMED" }),
      makeEvent({ event_type: "BOOKING_CONFIRMED" }),
      makeEvent({ event_type: "INQUIRY_SUBMITTED" }),
      makeEvent({ event_type: "INQUIRY_SUBMITTED" }),
      makeEvent({ event_type: "INQUIRY_SUBMITTED" }),
      makeEvent({ event_type: "INQUIRY_SUBMITTED" }),
    ];
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(events) }),
      toArray: vi.fn().mockResolvedValue(events),
    });
    const result = await getOverviewAnalytics("agency_xyz", range, "last_30_days");
    expect(result.summary.conversionRate).toBe(33.3);
  });

  it("returns 0 conversionRate when no inquiries", async () => {
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      toArray: vi.fn().mockResolvedValue([]),
    });
    const result = await getOverviewAnalytics("agency_xyz", range, "last_30_days");
    expect(result.summary.conversionRate).toBe(0);
  });
});

describe("getPackageAnalytics()", () => {
  beforeEach(() => vi.clearAllMocks());

  const range = { from: new Date("2024-01-01"), to: new Date("2024-01-31") };

  it("returns topByBookings and topByRevenue", async () => {
    const events = [
      makeEvent({ event_type: "BOOKING_CONFIRMED", package_id: "pkg_1" }),
      makeEvent({ event_type: "BOOKING_CONFIRMED", package_id: "pkg_1" }),
      makeEvent({ event_type: "BOOKING_CONFIRMED", package_id: "pkg_2" }),
      makeEvent({ event_type: "BOOKING_PAID", package_id: "pkg_2", metadata: { amount: 9000 } }),
    ];
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(events) }),
      toArray: vi.fn().mockResolvedValue(events),
    });
    const result = await getPackageAnalytics("agency_xyz", range);
    expect(result.topByBookings[0].package_id).toBe("pkg_1");
    expect(result.topByRevenue[0].package_id).toBe("pkg_2");
  });

  it("returns empty arrays when no events", async () => {
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      toArray: vi.fn().mockResolvedValue([]),
    });
    const result = await getPackageAnalytics("agency_xyz", range);
    expect(result.topByBookings).toHaveLength(0);
    expect(result.topByRevenue).toHaveLength(0);
  });

  it("counts every distinct package with activity, not just the top-10 slice shown", async () => {
    // 12 distinct packages, one booking each — `total` must be 12, not 10.
    const events = Array.from({ length: 12 }, (_, i) => makeEvent({ event_type: "BOOKING_CONFIRMED", package_id: `pkg_${i}` }));
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(events) }),
      toArray: vi.fn().mockResolvedValue(events),
    });
    const result = await getPackageAnalytics("agency_xyz", range);
    expect(result.topByBookings).toHaveLength(10);
    expect(result.total).toBe(12);
  });
});

describe("getOriginPackagePerformance()", () => {
  beforeEach(() => vi.clearAllMocks());

  const range = { from: new Date("2024-01-01"), to: new Date("2024-01-31") };
  const booking = (overrides: Record<string, unknown> = {}) => ({
    trekkerCountry: "Germany",
    packageId: "pkg_1",
    totalPrice: "100.00",
    createdAt: new Date("2024-01-10"),
    package: { title: "EBC Trek" },
    ...overrides,
  });

  it("groups by country + package and sums real booking amounts", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking({ totalPrice: "100.00" }),
      booking({ totalPrice: "150.00" }),
      booking({ trekkerCountry: "France", totalPrice: "200.00" }),
    ] as never);

    const rows = await getOriginPackagePerformance("agency_xyz", range);

    expect(rows).toHaveLength(2);
    const germany = rows.find((r) => r.country === "Germany")!;
    expect(germany.bookings).toBe(2);
    expect(germany.revenueNet).toBe(250);
    expect(germany.avgValue).toBe(125);
    expect(germany.packageTitle).toBe("EBC Trek");
  });

  it("falls back to 'Unknown' when trekkerCountry is not set", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([booking({ trekkerCountry: null })] as never);

    const rows = await getOriginPackagePerformance("agency_xyz", range);

    expect(rows[0].country).toBe("Unknown");
  });

  it("tracks the most recent booking date per group", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking({ createdAt: new Date("2024-01-05") }),
      booking({ createdAt: new Date("2024-01-20") }),
    ] as never);

    const rows = await getOriginPackagePerformance("agency_xyz", range);

    expect(rows[0].lastBooking).toBe(new Date("2024-01-20").toISOString());
  });

  it("returns an empty list when there are no matching bookings", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([] as never);

    const rows = await getOriginPackagePerformance("agency_xyz", range);

    expect(rows).toHaveLength(0);
  });
});

describe("getCustomerAnalytics()", () => {
  beforeEach(() => vi.clearAllMocks());

  const range = { from: new Date("2024-01-01"), to: new Date("2024-01-31") };

  it("correctly identifies new vs returning customers", async () => {
    const events = [
      makeEvent({ trekker_id: "t1" }),
      makeEvent({ trekker_id: "t2" }),
      makeEvent({ trekker_id: "t2" }),
    ];
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(events) }),
      toArray: vi.fn().mockResolvedValue(events),
    });
    const result = await getCustomerAnalytics("agency_xyz", range);
    expect(result.summary.newCustomers).toBe(1);
    expect(result.summary.returningCustomers).toBe(1);
  });

  it("returns geographic sources", async () => {
    const events = [
      makeEvent({ metadata: { country: "Nepal", amount: 0 } }),
      makeEvent({ metadata: { country: "Nepal", amount: 0 } }),
      makeEvent({ metadata: { country: "India", amount: 0 } }),
    ];
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(events) }),
      toArray: vi.fn().mockResolvedValue(events),
    });
    const result = await getCustomerAnalytics("agency_xyz", range);
    expect(result.geographicSources[0].country).toBe("Nepal");
    expect(result.geographicSources[0].count).toBe(2);
  });
});

describe("getGuideAnalytics()", () => {
  beforeEach(() => vi.clearAllMocks());

  const range = { from: new Date("2024-01-01"), to: new Date("2024-01-31") };

  it("calculates bookings per guide", async () => {
    const events = [
      makeEvent({ metadata: { guide_id: "g1" } }),
      makeEvent({ metadata: { guide_id: "g1" } }),
      makeEvent({ metadata: { guide_id: "g2" } }),
    ];
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(events) }),
      toArray: vi.fn().mockResolvedValue(events),
    });
    const result = await getGuideAnalytics("agency_xyz", range);
    expect(result.summary.totalGuides).toBe(2);
    expect(result.summary.avgBookingsPerGuide).toBe(1.5);
    expect(result.guides[0].guide_id).toBe("g1");
    expect(result.guides[0].bookings).toBe(2);
  });

  it("handles events with no guide_id", async () => {
    const events = [
      makeEvent({ metadata: {} }),
      makeEvent({ metadata: {} }),
    ];
    findMock.mockReturnValue({
      sort:    vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(events) }),
      toArray: vi.fn().mockResolvedValue(events),
    });
    const result = await getGuideAnalytics("agency_xyz", range);
    expect(result.summary.totalGuides).toBe(0);
    expect(result.summary.utilizationRate).toBe(0);
  });
});