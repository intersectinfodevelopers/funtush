import { describe, it, expect, vi, beforeEach } from "vitest";

// 
vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      insertOne:      vi.fn().mockResolvedValue({ insertedId: "mock_id" }),
      countDocuments: vi.fn().mockResolvedValue(0),
      find:           vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit:   vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
      updateOne:   vi.fn().mockResolvedValue({ upsertedId: "mock_id" }),
      distinct:    vi.fn().mockResolvedValue([]),
      createIndex: vi.fn().mockResolvedValue("index_name"),
    }),
  }),
}));

import { trackEvent, upsertDailySummary, getAgencyEvents } from "../src/services/analytics.service";
import { ANALYTICS_EVENT_TYPES } from "../src/models/analyticsEvent.model";
import { getMongo } from "../src/lib/mongo";

// Helper to get the mocked collection
async function getCol() {
  const db = await getMongo();
  return db.collection("analytics_events");
}

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

    const col = await getCol();
    expect(col.insertOne).toHaveBeenCalledOnce();
    const inserted = vi.mocked(col.insertOne).mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.agency_id).toBe("agency_xyz");
    expect(inserted.event_type).toBe("BOOKING_CONFIRMED");
    expect(inserted.trekker_id).toBe("trekker_001");
    expect(inserted.package_id).toBe("pkg_001");
    expect(inserted.timestamp).toBeInstanceOf(Date);
  });

  it("sets trekker_id and package_id to null when not provided", async () => {
    await trackEvent({ agency_id: "agency_xyz", event_type: "PAGE_VIEW" });
    const col = await getCol();
    const inserted = vi.mocked(col.insertOne).mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.trekker_id).toBeNull();
    expect(inserted.package_id).toBeNull();
  });

  it("does not throw when MongoDB fails (fail-safe)", async () => {
    const col = await getCol();
    vi.mocked(col.insertOne).mockRejectedValueOnce(new Error("MongoDB down"));
    await expect(
      trackEvent({ agency_id: "agency_xyz", event_type: "BOOKING_PAID" })
    ).resolves.not.toThrow();
  });

  it("tracks PAGE_VIEW event", async () => {
    await trackEvent({ agency_id: "agency_xyz", event_type: "PAGE_VIEW" });
    const col = await getCol();
    const inserted = vi.mocked(col.insertOne).mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.event_type).toBe("PAGE_VIEW");
  });

  it("tracks INQUIRY_SUBMITTED event", async () => {
    await trackEvent({ agency_id: "agency_xyz", event_type: "INQUIRY_SUBMITTED" });
    const col = await getCol();
    const inserted = vi.mocked(col.insertOne).mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.event_type).toBe("INQUIRY_SUBMITTED");
  });

  it("tracks BOOKING_CANCELLED event", async () => {
    await trackEvent({ agency_id: "agency_xyz", event_type: "BOOKING_CANCELLED" });
    const col = await getCol();
    const inserted = vi.mocked(col.insertOne).mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.event_type).toBe("BOOKING_CANCELLED");
  });
});

describe("upsertDailySummary()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not throw when MongoDB fails", async () => {
    const col = await getCol();
    vi.mocked(col.countDocuments).mockRejectedValueOnce(new Error("MongoDB down"));
    await expect(upsertDailySummary("agency_xyz", "2024-01-15")).resolves.not.toThrow();
  });

  it("calls updateOne with upsert:true", async () => {
    const col = await getCol();
    vi.mocked(col.countDocuments).mockResolvedValue(5);
    vi.mocked(col.find("").sort("").toArray).mockResolvedValue([
      { metadata: { amount: 500 } } as never,
    ]);

    await upsertDailySummary("agency_xyz", "2024-01-15");

    expect(col.updateOne).toHaveBeenCalledOnce();
    const call = vi.mocked(col.updateOne).mock.calls[0];
    expect(call[0]).toEqual({ agency_id: "agency_xyz", date: "2024-01-15" });
    expect(call[2]).toEqual({ upsert: true });
  });

  it("summary contains correct fields", async () => {
    const col = await getCol();
    vi.mocked(col.countDocuments).mockResolvedValue(3);
    vi.mocked(col.find("").sort("").toArray).mockResolvedValue([]);

    await upsertDailySummary("agency_xyz", "2024-01-15");

    const call = vi.mocked(col.updateOne).mock.calls[0];
    const doc = (call[1] as Record<string, unknown>).$set as Record<string, unknown>;
    expect(doc.date).toBe("2024-01-15");
    expect(doc.agency_id).toBe("agency_xyz");
    expect(typeof doc.new_inquiries).toBe("number");
    expect(typeof doc.confirmed).toBe("number");
    expect(typeof doc.revenue).toBe("number");
    expect(typeof doc.cancelled).toBe("number");
    expect(doc.updated_at).toBeInstanceOf(Date);
  });
});

describe("bookingAnalyticsMiddleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires BOOKING_CONFIRMED event on confirmed booking response", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");
    const col = await getCol();

    const req = { agencyId: "agency_xyz", method: "PATCH", path: "/bookings/1/status", params: {} } as never;
    const res = { statusCode: 200, json: vi.fn().mockReturnThis() } as never;
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    (res as never as { json: (b: unknown) => void }).json({ id: "b1", status: "CONFIRMED", agencyId: "agency_xyz" });
    await new Promise((r) => setTimeout(r, 20));

    expect(col.insertOne).toHaveBeenCalled();
    const event = vi.mocked(col.insertOne).mock.calls[0][0] as Record<string, unknown>;
    expect(event.event_type).toBe("BOOKING_CONFIRMED");
  });

  it("fires BOOKING_PAID event", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");
    const col = await getCol();

    const req = { agencyId: "agency_xyz", method: "PATCH", path: "/bookings/1/status", params: {} } as never;
    const res = { statusCode: 200, json: vi.fn().mockReturnThis() } as never;
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    (res as never as { json: (b: unknown) => void }).json({ id: "b1", status: "PAID", totalAmount: 5000 });
    await new Promise((r) => setTimeout(r, 20));

    const event = vi.mocked(col.insertOne).mock.calls[0][0] as Record<string, unknown>;
    expect(event.event_type).toBe("BOOKING_PAID");
  });

  it("does not fire event when agencyId is missing", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");
    const col = await getCol();

    const req = { agencyId: null, method: "PATCH", path: "/bookings/1/status", params: {} } as never;
    const res = { statusCode: 200, json: vi.fn().mockReturnThis() } as never;
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    (res as never as { json: (b: unknown) => void }).json({ id: "b1", status: "CONFIRMED" });
    await new Promise((r) => setTimeout(r, 20));

    expect(col.insertOne).not.toHaveBeenCalled();
  });

  it("does not fire event on error responses", async () => {
    const { bookingAnalyticsMiddleware } = await import("../src/middleware/bookingAnalytics.middleware");
    const col = await getCol();

    const req = { agencyId: "agency_xyz", method: "PATCH", path: "/bookings/1/status", params: {} } as never;
    const res = { statusCode: 400, json: vi.fn().mockReturnThis() } as never;
    const next = vi.fn();

    bookingAnalyticsMiddleware(req, res, next);
    (res as never as { json: (b: unknown) => void }).json({ error: "Bad request" });
    await new Promise((r) => setTimeout(r, 20));

    expect(col.insertOne).not.toHaveBeenCalled();
  });
});