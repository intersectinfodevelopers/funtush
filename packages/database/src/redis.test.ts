import { describe, expect, it, vi } from "vitest";

// In-memory stand-in for ioredis so the cache/session/rate-limit helpers can be
// tested without a live Redis server. Only the commands used by redis.ts are
// implemented; extra args (e.g. "EX", ttl) are accepted and ignored.
vi.mock("ioredis", () => {
  class FakeRedis {
    private store = new Map<string, string>();

    on() {
      return this;
    }
    async ping() {
      return "PONG";
    }
    async set(key: string, value: string) {
      this.store.set(key, value);
      return "OK";
    }
    async get(key: string) {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    async del(key: string) {
      this.store.delete(key);
      return 1;
    }
    async incr(key: string) {
      const next = (Number(this.store.get(key)) || 0) + 1;
      this.store.set(key, String(next));
      return next;
    }
    async expire() {
      return 1;
    }
    async quit() {
      return "OK";
    }
  }

  return { default: FakeRedis };
});

import {
  redis,
  setCache,
  getCache,
  deleteCache,
  checkRateLimit,
  setSession,
  getSession,
} from "./redis.js";

describe("Redis connection", () => {
  it("responds to PING with PONG", async () => {
    expect(await redis.ping()).toBe("PONG");
  });
});

describe("cache helpers", () => {
  it("round-trips a JSON value through set/get", async () => {
    await setCache("demo", { hello: "funtush" }, 60);
    expect(await getCache<{ hello: string }>("demo")).toEqual({ hello: "funtush" });
  });

  it("returns null for a missing key", async () => {
    expect(await getCache("does-not-exist")).toBeNull();
  });

  it("deletes a cached value", async () => {
    await setCache("temp", 123, 60);
    await deleteCache("temp");
    expect(await getCache("temp")).toBeNull();
  });
});

describe("rate limiting", () => {
  it("allows requests under the limit and blocks once exceeded", async () => {
    const ip = "10.0.0.1";
    expect(await checkRateLimit(ip, 2, 60)).toBe(true);
    expect(await checkRateLimit(ip, 2, 60)).toBe(true);
    expect(await checkRateLimit(ip, 2, 60)).toBe(false);
  });
});

describe("session helpers", () => {
  it("round-trips session data", async () => {
    await setSession("user-42", { role: "agency_admin" });
    expect(await getSession<{ role: string }>("user-42")).toEqual({ role: "agency_admin" });
  });

  it("returns null when no session exists", async () => {
    expect(await getSession("nobody")).toBeNull();
  });
});
