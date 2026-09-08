import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

// --- Mock FCM so tests never hit Firebase ---
vi.mock("../src/lib/firebase", () => ({
  sendPush: vi.fn(async () => ({ ok: true, successCount: 1, failureCount: 0, invalidTokens: [] })),
}));

import { sendPush } from "../src/lib/firebase";
import {
  initNotificationService,
  notifyUser,
} from "../src/services/notificationDispatch.service";
import { NOTIFICATION_MATRIX } from "../src/config/notificationMatrix";

// --- Minimal in-memory fake of the Mongo Db surface the service uses ---
function fakeDb(opts: { user?: Record<string, unknown> | null } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const updates: unknown[] = [];
  const db = {
    collection: (name: string) => ({
      findOne: vi.fn(async () => (name === "users" ? opts.user ?? null : null)),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => {
        inserted.push(doc);
        return { insertedId: new ObjectId() };
      }),
      updateOne: vi.fn(async (_f: unknown, u: unknown) => {
        updates.push(u);
        return { modifiedCount: 1 };
      }),
      createIndex: vi.fn(async () => "ok"),
      find: vi.fn(() => ({ map: () => ({ toArray: async () => [] }) })),
      deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
    }),
  };
  return { db: db as never, inserted, updates };
}

const fakeMailer = { sendMail: vi.fn(async () => ({ messageId: "test" })) } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notification matrix", () => {
  it("marks SOS_ALERT and PAYMENT_FAILED as CRITICAL", () => {
    expect(NOTIFICATION_MATRIX.SOS_ALERT.priority).toBe("CRITICAL");
    expect(NOTIFICATION_MATRIX.PAYMENT_FAILED.priority).toBe("CRITICAL");
  });

  it("keeps PROMO in_app-only at LOW priority", () => {
    expect(NOTIFICATION_MATRIX.PROMO).toEqual({ priority: "LOW", channels: ["in_app"] });
  });
});

describe("notifyUser", () => {
  it("throws on unknown event types", async () => {
    const { db } = fakeDb();
    initNotificationService(db, fakeMailer);
    await expect(
      notifyUser("u1", "NOT_A_REAL_EVENT" as never, { title: "x", body: "y" })
    ).rejects.toThrow(/Unknown notification event type/);
  });

  it("resolves channels from the matrix and persists the event", async () => {
    const { db, inserted } = fakeDb({ user: { email: "a@b.com" } });
    initNotificationService(db, fakeMailer);

    const res = await notifyUser("u1", "BOOKING_CONFIRMED", {
      title: "Booking confirmed",
      body: "Your trek is booked",
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      event_type: "BOOKING_CONFIRMED",
      priority: "HIGH",
      recipient_type: "user",
    });
    expect(res.results.map((r) => r.channel).sort()).toEqual(["email", "in_app", "push"]);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("suppresses push under DND for non-critical events", async () => {
    const { db } = fakeDb({
      user: { email: "a@b.com", notification_prefs: { dnd: { enabled: true } } },
    });
    initNotificationService(db, fakeMailer);

    const res = await notifyUser("u1", "NEW_MESSAGE", { title: "Hi", body: "msg" });

    expect(res.skipped).toContain("push");
    expect(res.results.map((r) => r.channel)).not.toContain("push");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("CRITICAL events bypass DND", async () => {
    const { db } = fakeDb({
      user: { email: "a@b.com", notification_prefs: { dnd: { enabled: true } } },
    });
    initNotificationService(db, fakeMailer);

    const res = await notifyUser("u1", "SOS_ALERT", { title: "SOS", body: "help" });

    expect(res.skipped).toHaveLength(0);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(res.results.map((r) => r.channel)).toContain("push");
  });

  it("reports partial status when one channel fails", async () => {
    (sendPush as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, successCount: 0, failureCount: 1, invalidTokens: [], error: "no_device_tokens",
    });
    const { db } = fakeDb({ user: { email: "a@b.com" } });
    initNotificationService(db, fakeMailer);

    const res = await notifyUser("u1", "BOOKING_CANCELLED", { title: "x", body: "y" });

    expect(res.status).toBe("partial");
    expect(res.results.find((r) => r.channel === "push")?.ok).toBe(false);
    expect(res.results.find((r) => r.channel === "email")?.ok).toBe(true);
  });
});