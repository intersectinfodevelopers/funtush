import type { Db } from "mongodb";
import nodemailer, { type Transporter } from "nodemailer";
import { NOTIFICATION_MATRIX, DND_SUPPRESSIBLE } from "../config/notificationMatrix";
import { sendPush } from "../lib/firebase";
import type {
  ChannelResult,
  NotificationChannel,
  NotificationEventDoc,
  NotificationEventType,
  NotifyPayload,
  RecipientType,
} from "../types/notification.types";

/**
 * Notification dispatch service.
 *
 * Usage (wire once at boot in src/index.ts / app.ts):
 *   import { initNotificationService } from "./services/notification.service";
 *   initNotificationService(db);          // db = connected Db from @funtush/database
 *
 * Then anywhere:
 *   await notifyUser(userId, "BOOKING_CONFIRMED", { title, body, data });
 */

const COLLECTION = "notification_events";

let _db: Db | null = null;
let _mailer: Transporter | null = null;

export function initNotificationService(db: Db, mailer?: Transporter): void {
  _db = db;
  _mailer =
    mailer ??
    nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
}

function db(): Db {
  if (!_db) throw new Error("Notification service not initialised — call initNotificationService(db) at boot");
  return _db;
}

/** Ensure indexes once at boot (idempotent). Call after initNotificationService. */
export async function ensureNotificationIndexes(): Promise<void> {
  const col = db().collection<NotificationEventDoc>(COLLECTION);
  await col.createIndex({ recipient_id: 1, created_at: -1 });
  await col.createIndex({ status: 1, created_at: -1 });
}

/** Is the recipient currently in Do Not Disturb? Reads users.notification_prefs. */
async function isDndActive(userId: string): Promise<boolean> {
  const user = await db()
    .collection("users")
    .findOne(
      { _id: { $eq: toIdQuery(userId) } as never },
      { projection: { "notification_prefs.dnd": 1 } }
    );
  const dnd = (user as { notification_prefs?: { dnd?: { enabled?: boolean; start?: string; end?: string } } } | null)
    ?.notification_prefs?.dnd;
  if (!dnd?.enabled) return false;
  // Window like { start: "22:00", end: "07:00" } — absent window = always-on DND.
  if (!dnd.start || !dnd.end) return true;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = dnd.start.split(":").map(Number);
  const [eh, em] = dnd.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end; // handles overnight windows
}

/** Users collection may key _id as ObjectId or string depending on tenant — try both. */
function toIdQuery(id: string): unknown {
  try {
    // Lazy import avoids hard dependency in tests that mock the db.
    const { ObjectId } = require("mongodb") as typeof import("mongodb");
    return ObjectId.isValid(id) ? new ObjectId(id) : id;
  } catch {
    return id;
  }
}

async function deliverEmail(userId: string, payload: NotifyPayload): Promise<ChannelResult> {
  try {
    let to = payload.email;
    if (!to) {
      const user = await db()
        .collection("users")
        .findOne({ _id: { $eq: toIdQuery(userId) } as never }, { projection: { email: 1 } });
      to = (user as { email?: string } | null)?.email;
    }
    if (!to) return { channel: "email", ok: false, error: "no_email_on_record" };
    if (!_mailer) return { channel: "email", ok: false, error: "mailer_not_initialised" };

    await _mailer.sendMail({
      from: process.env.SMTP_FROM ?? "Funtush <no-reply@funtush.com>",
      to,
      subject: payload.title,
      text: payload.body,
    });
    return { channel: "email", ok: true, delivered_at: new Date() };
  } catch (err) {
    return { channel: "email", ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function deliverPush(userId: string, payload: NotifyPayload): Promise<ChannelResult> {
  const res = await sendPush(db(), userId, payload.title, payload.body, payload.data ?? {});
  return res.ok
    ? { channel: "push", ok: true, delivered_at: new Date() }
    : { channel: "push", ok: false, error: res.error ?? `fcm_failures:${res.failureCount}` };
}

/** in_app is just the stored NotificationEventDoc itself — clients poll/stream it. */
function deliverInApp(): ChannelResult {
  return { channel: "in_app", ok: true, delivered_at: new Date() };
}

/** SMS is stubbed for Day 1 — provider (e.g. Sparrow SMS / Twilio) lands later. */
function deliverSms(): ChannelResult {
  return { channel: "sms", ok: false, error: "sms_provider_not_configured" };
}

export interface NotifyResult {
  eventId: string;
  status: NotificationEventDoc["status"];
  results: ChannelResult[];
  skipped: NotificationChannel[]; // channels suppressed by DND
}

/**
 * Dispatch a notification to a user.
 *
 * 1. Resolves priority + channels from NOTIFICATION_MATRIX (unknown event → throws).
 * 2. Applies DND: CRITICAL bypasses it; otherwise push/sms are suppressed.
 * 3. Persists a NotificationEvent doc (status: pending) — this doubles as the in_app feed.
 * 4. Fans out to remaining channels in parallel, records per-channel results.
 * 5. Updates status: sent (all ok) / partial (some ok) / failed (none ok).
 */
export async function notifyUser(
  userId: string,
  eventType: NotificationEventType,
  payload: NotifyPayload,
  recipientType: RecipientType = "user"
): Promise<NotifyResult> {
  const entry = NOTIFICATION_MATRIX[eventType];
  if (!entry) throw new Error(`Unknown notification event type: ${eventType}`);

  // --- Resolve effective channels (DND) ---
  let channels = [...entry.channels];
  let skipped: NotificationChannel[] = [];
  if (entry.priority !== "CRITICAL" && (await isDndActive(userId))) {
    skipped = channels.filter((c) => DND_SUPPRESSIBLE.includes(c));
    channels = channels.filter((c) => !DND_SUPPRESSIBLE.includes(c));
  }

  // --- Persist event (pending) — also serves as the in_app record ---
  const col = db().collection<NotificationEventDoc>(COLLECTION);
  const doc: NotificationEventDoc = {
    recipient_id: userId,
    recipient_type: recipientType,
    event_type: eventType,
    channels,
    priority: entry.priority,
    status: "pending",
    payload: { ...payload },
    results: [],
    created_at: new Date(),
  };
  const { insertedId } = await col.insertOne(doc);

  // --- Fan out in parallel ---
  const tasks = channels.map((c): Promise<ChannelResult> => {
    switch (c) {
      case "push":   return deliverPush(userId, payload);
      case "email":  return deliverEmail(userId, payload);
      case "in_app": return Promise.resolve(deliverInApp());
      case "sms":    return Promise.resolve(deliverSms());
    }
  });
  const settled = await Promise.allSettled(tasks);
  const results: ChannelResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { channel: channels[i], ok: false, error: String(s.reason) }
  );

  const okCount = results.filter((r) => r.ok).length;
  const status =
    okCount === results.length && results.length > 0 ? "sent"
    : okCount > 0 ? "partial"
    : "failed";

  await col.updateOne(
    { _id: insertedId },
    { $set: { results, status, sent_at: new Date() } }
  );

  return { eventId: insertedId.toHexString(), status, results, skipped };
}