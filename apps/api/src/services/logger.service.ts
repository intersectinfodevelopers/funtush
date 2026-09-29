import { getMongo } from "../lib/mongo.js";

export interface RequestLog {
  requestId:    string;
  method:       string;
  path:         string;
  statusCode:   number;
  responseTime: number;
  ip:           string;
  tenantId?:    string | null;
  agencyId?:    string | null;
  userAgent?:   string;
  timestamp:    Date;
}

/**
 * Request logs are buffered and written in batches. One Mongo `insertOne` per
 * HTTP request meant every request carried its own network round-trip and
 * write, which on a busy API costs as much as the work being logged.
 *
 * - flushed every FLUSH_INTERVAL_MS, or as soon as BATCH_SIZE entries queue up
 * - the buffer is bounded: if Mongo is down/slow, the OLDEST entries are
 *   dropped rather than growing process memory without limit (access logs are
 *   best-effort; they must never take the API down with them)
 */
const FLUSH_INTERVAL_MS = 1000;
const BATCH_SIZE = 200;
const MAX_BUFFER = 10_000;

/** Access logs carry IPs and user agents — don't keep them forever. */
const RETENTION_DAYS = Number(process.env.REQUEST_LOG_RETENTION_DAYS ?? 30);

let buffer: RequestLog[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing = false;
let indexEnsured = false;

async function ensureRetentionIndex(): Promise<void> {
  if (indexEnsured) return;
  const db = await getMongo();
  // TTL index: Mongo deletes documents itself once `timestamp` is older than this.
  await db.collection("request_logs").createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: Math.max(1, RETENTION_DAYS) * 24 * 60 * 60, name: "request_logs_ttl" },
  );
  indexEnsured = true;
}

export async function flushRequestLogs(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer;
  buffer = [];
  try {
    await ensureRetentionIndex().catch((err) => console.error("[Logger] TTL index failed:", err));
    const db = await getMongo();
    await db.collection("request_logs").insertMany(batch, { ordered: false });
  } catch (err) {
    console.error(`[Logger] Failed to save ${batch.length} logs:`, err);
  } finally {
    flushing = false;
  }
}

function schedule(): void {
  if (timer) return;
  timer = setInterval(() => { void flushRequestLogs(); }, FLUSH_INTERVAL_MS);
  // never keep the process alive just to flush logs
  timer.unref();
}

export function saveRequestLog(log: RequestLog): void {
  buffer.push(log);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  schedule();
  if (buffer.length >= BATCH_SIZE) void flushRequestLogs();
}
