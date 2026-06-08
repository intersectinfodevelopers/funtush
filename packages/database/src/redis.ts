import Redis, { type Redis as RedisClient } from "ioredis";

/**
 * Single shared Redis client (Backend Guide §3: sessions, rate limiting,
 * caching, realtime). Mirrors the pg Pool in db.ts — one instance per process.
 */
// ioredis typings can sometimes expose a module namespace rather than a
// constructable class depending on TS config. Normalize to a constructor
// at runtime to avoid "not constructable" errors.
const RedisConstructor = Redis as unknown as new (connectionUrl: string) => RedisClient;

export const redis = new RedisConstructor(
  process.env.REDIS_URL ?? "redis://localhost:6379"
);

redis.on("connect", () => console.log("Redis connected"));
redis.on("error", (err: Error) => console.error("Redis error:", err.message));

/* ── Cache helpers ─────────────────────────────────────────── */

/** Store a JSON-serializable value with a TTL (seconds). */
export async function setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

/** Read and parse a cached value, or null if missing/expired. */
export async function getCache<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

/** Delete a cached value immediately. */
export async function deleteCache(key: string): Promise<void> {
  await redis.del(key);
}

/* ── Rate limiting (fixed-window counter) ──────────────────── */

/** Returns true if this IP is still under `limit` requests in `windowSeconds`. */
export async function checkRateLimit(ip: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = `ratelimit:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}

/* ── Session helpers ───────────────────────────────────────── */

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 1 day

/** Persist a user's session data. */
export async function setSession(userId: string, data: unknown): Promise<void> {
  await redis.set(`session:${userId}`, JSON.stringify(data), "EX", SESSION_TTL_SECONDS);
}

/** Read a user's session data, or null if none. */
export async function getSession<T>(userId: string): Promise<T | null> {
  const raw = await redis.get(`session:${userId}`);
  return raw === null ? null : (JSON.parse(raw) as T);
}
