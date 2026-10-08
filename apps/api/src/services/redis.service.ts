import { redis } from "../lib/redis.js";

export const TENANT_TTL = 300;

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const data = await redis.get(key);
    return data ? (JSON.parse(data) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttl: number = TENANT_TTL): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch (err) {
    console.error("[Redis] cacheSet failed:", err);
  }
}

/**
 * Atomically "claim" a key for `ttl` seconds: resolves true for the first caller and false for every other caller
 * until the key expires (SET NX EX). Used to ignore duplicate submissions. Fails OPEN — if Redis is unavailable it
 * resolves true, so a cache outage can never block the action being protected.
 */
export async function claimOnce(key: string, ttl: number): Promise<boolean> {
  try {
    return (await redis.set(key, "1", "EX", ttl, "NX")) === "OK";
  } catch (err) {
    console.error("[Redis] claimOnce failed (allowing the action):", err);
    return true;
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (err) {
    console.error("[Redis] cacheDel failed:", err);
  }
}
