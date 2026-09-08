import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted mock ───────────────────────────────────────────────────────────
const { findMock } = vi.hoisted(() => ({
  findMock: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      find:        findMock,
      createIndex: vi.fn().mockResolvedValue("ok"),
    }),
  }),
}));

import {
  buildReportData,
  monthRange,
  yearRange,
  monthLabel,
  toCSV,
  toHTML,
} from "../src/services/report.service";

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  agency_id:  "agency_xyz",
  event_type: "BOOKING_CONFIRMED",
  trekker_id: "t1",
  package_id: "pkg_1",
  timestamp:  new Date("2024-03-15T10:00:00Z"),
  metadata:   { amount: 1000, guide_id: "guide_1" },
  ...overrides,
});

describe("monthRange()", () => {
  it("returns correct start and end for a month", () => {
    const { from, to } = monthRange("2024-03");
    expect(from.toISOString().startsWith("2024-03-01")).toBe(true);
    expect(to.toISOString().startsWith("2024-03-31")).toBe(true);
  });

  it("throws on invalid month", () => {
    expect(() => monthRange("2024-13")).toThrow("Invalid month");
    expect(() => monthRange("bad")).toThrow("Invalid month");
  });
});

describe("yearRange()", () => {
  it("returns Jan 1 to Dec 31", () => {
    const { from, to } = yearRange("2024");
    expect(from.toISOString().startsWith("2024-01-01")).toBe(true);
    expect(to.toISOString().startsWith("2024-12-31")).toBe(true);
  });

  it("throws on invalid year", () => {
    expect(() => yearRange("abc")).toThrow("Invalid year");
  });
});

describe("monthLabel()", () => {
  it("formats month nicely", () => {
    expect(monthLabel("2024-03")).toBe("March 2024");
    expect(monthLabel("2024-12")).toBe("December 2024");
  });
});

describe("buildReportData()", () => {
  beforeEach(() => vi.clearAllMocks());

  const range = monthRange("2024-03");

  it("returns correct shape", async () => {
    findMock.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const data = await buildReportData("agency_xyz", range, "March 2024");
    expect(data).toHaveProperty("summary");
    expect(data).toHaveProperty("topPackages");
    expect(data).toHaveProperty("guides");
    expect(data).toHaveProperty("bookingsByDay");
    expect(data.periodLabel).toBe("March 2024");
  });

  it("calculates totalRevenue from paid events", async () => {
    findMock.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        makeEvent({ event_type: "BOOKING_PAID", metadata: { amount: 2000 } }),
        makeEvent({ event_type: "BOOKING_PAID", metadata: { amount: 3000 } }),
      ]),
    });
    const data = await buildReportData("agency_xyz", range, "March 2024");
    expect(data.summary.totalRevenue).toBe(5000);
  });

  it("counts bookings, inquiries, cancelled", async () => {
    findMock.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeEvent(), makeEvent()]),
    });
    const data = await buildReportData("agency_xyz", range, "March 2024");
    expect(data.summary.totalBookings).toBe(2);
  });
});

describe("toCSV()", () => {
  it("produces CSV with summary section", () => {
    const data = {
      agencyId: "agency_xyz",
      periodLabel: "March 2024",
      generatedAt: "2024-04-01T00:00:00Z",
      summary: { totalBookings: 5, totalRevenue: 10000, totalInquiries: 20, cancelled: 1, conversionRate: 25 },
      topPackages: [{ package_id: "pkg_1", bookings: 3, revenue: 6000 }],
      guides:      [{ guide_id: "g1", bookings: 2 }],
      bookingsByDay: [{ date: "2024-03-15", count: 2 }],
    };
    const csv = toCSV(data);
    expect(csv).toContain("SUMMARY");
    expect(csv).toContain("Total Bookings,5");
    expect(csv).toContain("TOP PACKAGES");
    expect(csv).toContain("pkg_1,3,6000");
    expect(csv).toContain("GUIDES");
    expect(csv).toContain("g1,2");
  });
});

describe("toHTML()", () => {
  it("produces HTML with agency and period", () => {
    const data = {
      agencyId: "agency_xyz",
      periodLabel: "March 2024",
      generatedAt: "2024-04-01T00:00:00Z",
      summary: { totalBookings: 5, totalRevenue: 10000, totalInquiries: 20, cancelled: 1, conversionRate: 25 },
      topPackages: [{ package_id: "pkg_1", bookings: 3, revenue: 6000 }],
      guides:      [{ guide_id: "g1", bookings: 2 }],
      bookingsByDay: [],
    };
    const html = toHTML(data);
    expect(html).toContain("Funtush Report");
    expect(html).toContain("March 2024");
    expect(html).toContain("agency_xyz");
    expect(html).toContain("pkg_1");
  });
});
