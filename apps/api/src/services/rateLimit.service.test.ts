import { describe, it, expect, vi, beforeEach } from "vitest";

const { redisMock } = vi.hoisted(() => ({
  redisMock: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}));
vi.mock("../lib/redis.js", () => ({ redis: redisMock }));

import { checkRateLimit, SOS_PATHS } from "./rateLimit.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkRateLimit — safety routes are never limited", () => {
  it("exempts the agency Safety Monitoring feed (the real, current route)", async () => {
    const result = await checkRateLimit("1.2.3.4", "GET", "/agencies/me/safety/incidents/active");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(999);
    // Redis must never be touched for an exempt route — a life-safety feed
    // can't depend on Redis being up.
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it("exempts acknowledge/resolve/notes on an open incident, not just the feed itself", async () => {
    const r1 = await checkRateLimit("1.2.3.4", "PATCH", "/agencies/me/safety/incidents/abc123/acknowledge");
    const r2 = await checkRateLimit("1.2.3.4", "PATCH", "/agencies/me/safety/incidents/abc123/resolve");
    const r3 = await checkRateLimit("1.2.3.4", "POST", "/agencies/me/safety/incidents/abc123/notes");
    expect([r1, r2, r3].every((r) => r.allowed)).toBe(true);
  });

  it("still exempts the legacy /sos trigger path", async () => {
    const result = await checkRateLimit("1.2.3.4", "POST", "/sos/trigger");
    expect(result.allowed).toBe(true);
  });

  it("does NOT exempt an unrelated agency route that merely starts with a similar prefix", async () => {
    redisMock.incr.mockResolvedValue(1);
    redisMock.ttl.mockResolvedValue(60);
    const result = await checkRateLimit("1.2.3.4", "GET", "/agencies/me/staff");
    expect(result.limit).toBe(200); // DEFAULT config, not the 999 exemption
    expect(redisMock.incr).toHaveBeenCalled();
  });

  it("SOS_PATHS includes the real agency safety route prefix", () => {
    expect(SOS_PATHS.some((p) => "/agencies/me/safety/incidents/active".startsWith(p))).toBe(true);
  });
});

describe("checkRateLimit — non-exempt routes", () => {
  it("counts requests and allows until the limit", async () => {
    redisMock.incr.mockResolvedValue(1);
    redisMock.ttl.mockResolvedValue(60);
    const result = await checkRateLimit("1.2.3.4", "GET", "/agencies/me/staff");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(199);
  });

  it("blocks once the count exceeds the configured max", async () => {
    redisMock.incr.mockResolvedValue(201);
    redisMock.ttl.mockResolvedValue(30);
    const result = await checkRateLimit("1.2.3.4", "GET", "/agencies/me/staff");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("uses the stricter login-specific limit", async () => {
    redisMock.incr.mockResolvedValue(6);
    redisMock.ttl.mockResolvedValue(45);
    const result = await checkRateLimit("1.2.3.4", "POST", "/auth/agency/login");
    expect(result.limit).toBe(5);
    expect(result.allowed).toBe(false);
  });

  it("fails open when Redis errors", async () => {
    redisMock.incr.mockRejectedValue(new Error("connection refused"));
    const result = await checkRateLimit("1.2.3.4", "GET", "/agencies/me/staff");
    expect(result.allowed).toBe(true);
  });
});
