import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock MongoDB ──────────────────────────────────────────────────────────────
const insertOneMock   = vi.fn().mockResolvedValue({ insertedId: "mock_id" });
const countDocsMock   = vi.fn().mockResolvedValue(0);
const findMock        = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
const findToArrayMock = vi.fn().mockResolvedValue([]);
const updateOneMock   = vi.fn().mockResolvedValue({ upsertedId: "mock_id" });
const distinctMock    = vi.fn().mockResolvedValue([]);
const createIndexMock = vi.fn().mockResolvedValue("index_name");

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      insertOne:       insertOneMock,
      countDocuments:  countDocsMock,
      find:            vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit:   vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          toArray: findToArrayMock,
        }),
      }),
      updateOne:       updateOneMock,
      distinct:        distinctMock,
      createIndex:     createIndexMock,
    }),
  }),
}));

import { trackEvent, upsertDailySummary, getAgencyEvents, getAgencyDailySummaries } from "../src/services/analytics.service";
import { ANALYTICS_EVENT_TYPES } from "../src/models/analyticsEvent.model";

describe("Analytics Event Types", () => {
  it("contains all 5 required event types", () => {
    expect(ANALYTICS_EVENT_TYPES).toContain("PAGE_VIEW");
    expect(ANALYTICS_EVENT_TYPES).toContain("INQUIRY_SUBMITTED");
    expect(ANALYTICS_EVENT_TYPES).toContain("BOOKING_CONFIRMED");
    expect(ANALYTICS_EVENT_TYPES).toContain("BOOKING_PAID");
    expect(ANALYTICS_EVENT_TYPES).toContain("BOOKING_CANCELLED");
    expect(ANALYTICS_EVENT_TYPES).toHaveLength(5);
  });
});

describe("trackEvent()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts event with correct shape", async () => {
    await trackEvent({
      agency_id:  "agency_xyz",
      event_type: "BOOKING_CONFIRMED",
      trekker_id: "trekker_001",
      package_id: "pkg_001",
      metadata:   { booking_id: "booking_001", amount: 5000 },
    });

    expect(insertOneMock).toHaveBeenCalledOnce();
    const inserted = insertOneMock.mock.calls[0][0];
    expect(inserted.agency_id).toBe("agency_xyz");
    expect(inserted.event_type).toBe("BOOKING_CONFIRMED");
    expect(inserted.trekker_id).toBe("trekker_001");
    expect(inserted.package_id).toBe("pkg_001");
    expect(inserted.timestamp).toBeInstanceOf(Date);
    expect(inserted.metadata.booking_id).toBe("booking_001");
  });

  it("sets trekker_id and package_id to null when not provided", async () => {
    await trackEvent({ agency_id: "agency_xyz", event_type: "PAGE_VIEW" });
    const inserted = insertOneMock.mock.calls[0][0];
    expect(inserted.trekker_id).toBeNull();
    expect(inserted.package_id).toBeNull();
  });

  it("does not throw when MongoDB fails (fail-safe)", async () => {
    insertOneMock.mockRejectedValueOnce(new Error("MongoDB down"));
    await expect(
      trackEvent({ agency_id: "agency_xyz", event_type: "BOOKING_PAID" })
    ).resolves.not.toThrow();
  });

  it("tracks PAGE_VIEW event", async () => {
    await trackEvent({ agency_id: "agency_xyz", event_type: "PAGE_VIEW" });
    expect(insertOneMock.mock.calls[0][0].event_type).toBe("PAGE_VIEW");
  });

  it("tracks INQUIRY_SUBMITTED event", async () => {
    await trackEvent({ agency_id: "agency_xyz", event_type: "INQUIRY_SUBMITTED" });
    expect(insertOneMock.mock.calls[0][0].event_type).toBe("INQUIRY_SUBMITTED");
  });

  it("tracks BOOKING_CANCELLED event", async () => {
    await trackEvent({ agency_id: "agency_xyz", event_type: "BOOKING_CANCELLED" });
    expect(insertOneMock.mock.calls[0][0].event_type).toBe("BOOKING_CANCELLED");
  });
});

describe("upsertDailySummary()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts all event types for the day", async () => {
    countDocsMock.mockResolvedValue(3);
    findToArrayMock.mockResolvedValue([
      { metadata: { amount: 1000 } },
      { metadata: { amount: 2000 } },
    ]);

    await upsertDailySummary("agency_xyz", "2024-01-15");

    expect(countDocsMock).toHaveBeenCalledTimes(4);
    expect(updateOneMock).toHaveBeenCalledOnce();
  });

  it("upserts summary with correct shape", async () => {
    countDocsMock.mockResolvedValue(5);
    findToArrayMock.mockResolvedValue([{ metadata: { amount: 500 } }]);

    await upsertDailySummary("agency_xyz", "2024-01-15");

    const upsertCall = updateOneMock.mock.calls[0];
    expect(upsertCall[0]).toEqual({ agency_id: "agency_xyz", date: "2024-01-15" });
    expect(upsertCall[1].$set.agency_id).toBe("agency_xyz");
    expect(upsertCall[1].$set.date).toBe("2024-01-15");
    expect(upsertCall[2]).toEqual({ upsert: true });
  });

  it("calculates revenue from BOOKING_PAID metadata.amount", async () => {
    countDocsMock.mockResolvedValue(0);
    findToArrayMock.mockResolvedValue([
      { metadata: { amount: 1500 } },
      { metadata: { amount: 2500 } },
      { metadata: { amount: 1000 } },
    ]);

    await upsertDailySummary("agency_xyz", "2024-01-15");

    const upsertCall = updateOneMock.mock.calls[0];
    expect(upsertCall[1].$set.revenue).toBe(5000);
  });

  it("handles zero revenue gracefully", async () => {
    countDocsMock.mockResolvedValue(0);
    findToArrayMock.mockResolvedValue([]);

    await upsertDailySummary("agency_xyz", "2024-01-15");
    const upsertCall = updateOneMock.mock.calls[0];
    expect(upsertCall[1].$set.revenue).toBe(0);
  });

  it("does not throw when MongoDB fails", async () => {
    countDocsMock.mockRejectedValueOnce(new Error("MongoDB down"));
    await expect(upsertDailySummary("agency_xyz", "2024-01-15")).resolves.not.toThrow();
  });
});

describe("bookingAnalyticsMiddleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires BOOKING_CONFIRMED event on confirmed booking response", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");

    const req: any = { agencyId: "agency_xyz", method: "PATCH", path: "/bookings/1/status", params: {} };
    const res: any = {
      statusCode: 200,
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // Simulate route handler calling res.json
    res.json({ id: "booking_1", status: "CONFIRMED", agencyId: "agency_xyz" });
    await new Promise((r) => setTimeout(r, 20));

    expect(insertOneMock).toHaveBeenCalled();
    const event = insertOneMock.mock.calls[0][0];
    expect(event.event_type).toBe("BOOKING_CONFIRMED");
    expect(event.agency_id).toBe("agency_xyz");
  });

  it("fires BOOKING_PAID event on paid booking response", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");
    const req: any = { agencyId: "agency_xyz", method: "PATCH", path: "/bookings/1/status", params: {} };
    const res: any = { statusCode: 200, json: vi.fn().mockReturnThis() };
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    res.json({ id: "booking_1", status: "PAID", totalAmount: 5000 });
    await new Promise((r) => setTimeout(r, 20));

    const event = insertOneMock.mock.calls[0][0];
    expect(event.event_type).toBe("BOOKING_PAID");
    expect(event.metadata.amount).toBe(5000);
  });

  it("fires BOOKING_CANCELLED event on cancelled booking", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");
    const req: any = { agencyId: "agency_xyz", method: "PATCH", path: "/bookings/1/status", params: {} };
    const res: any = { statusCode: 200, json: vi.fn().mockReturnThis() };
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    res.json({ id: "booking_1", status: "CANCELLED" });
    await new Promise((r) => setTimeout(r, 20));

    const event = insertOneMock.mock.calls[0][0];
    expect(event.event_type).toBe("BOOKING_CANCELLED");
  });

  it("does not fire event when agencyId is missing", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");
    const req: any = { agencyId: null, method: "PATCH", path: "/bookings/1/status", params: {} };
    const res: any = { statusCode: 200, json: vi.fn().mockReturnThis() };
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    res.json({ id: "booking_1", status: "CONFIRMED" });
    await new Promise((r) => setTimeout(r, 20));

    expect(insertOneMock).not.toHaveBeenCalled();
  });

  it("does not fire event on error responses (4xx/5xx)", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");
    const req: any = { agencyId: "agency_xyz", method: "PATCH", path: "/bookings/1/status", params: {} };
    const res: any = { statusCode: 400, json: vi.fn().mockReturnThis() };
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    res.json({ error: "Bad request" });
    await new Promise((r) => setTimeout(r, 20));

    expect(insertOneMock).not.toHaveBeenCalled();
  });
});
