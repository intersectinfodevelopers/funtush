import { describe, it, expect, vi, beforeEach } from "vitest";

// 
const store: Record<string, number> = {};
const ttlStore: Record<string, number> = {};

vi.mock("../src/lib/redis", () => ({
  redis: {
    incr:   vi.fn(async (key: string) => { store[key] = (store[key] || 0) + 1; return store[key]; }),
    expire: vi.fn(async (key: string, ttl: number) => { ttlStore[key] = ttl; return 1; }),
    ttl:    vi.fn(async (key: string) => ttlStore[key] ?? -1),
  },
}));

import { checkRateLimit, SOS_PATHS, RATE_LIMITS } from "../src/services/rateLimit.service";
import { rateLimitMiddleware } from "../src/middleware/rateLimit.middleware";

interface MockRes {
  _status: number;
  _headers: Record<string, unknown>;
  _body: unknown;
  setHeader(k: string, v: unknown): void;
  status(c: number): MockRes;
  json(b: unknown): MockRes;
}

function mockReqRes(method: string, path: string, ip = "1.2.3.4") {
  const req = {
    method,
    path,
    headers: { "x-forwarded-for": ip },
    socket:  { remoteAddress: ip },
  };
  const res: MockRes = {
    _status:  200,
    _headers: {},
    _body:    null,
    setHeader(k: string, v: unknown) { this._headers[k] = v; },
    status(c: number)  { this._status = c; return this; },
    json(b: unknown)   { this._body   = b; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe("Rate limiting", () => {

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    Object.keys(ttlStore).forEach((k) => delete ttlStore[k]);
    vi.clearAllMocks();
  });

  // ── Rate Limiting ──────────────────────────────────────────────────────────

  it("RATE_LIMITS config: agency/login = 5/min", () => {
    expect(RATE_LIMITS["POST:/auth/agency/login"].maxRequests).toBe(5);
    expect(RATE_LIMITS["POST:/auth/agency/login"].windowSecs).toBe(60);
  });

  it("RATE_LIMITS config: trekker/register = 3/hour", () => {
    expect(RATE_LIMITS["POST:/auth/trekker/register"].maxRequests).toBe(3);
    expect(RATE_LIMITS["POST:/auth/trekker/register"].windowSecs).toBe(3600);
  });

  it("RATE_LIMITS config: DEFAULT = 200/min", () => {
    expect(RATE_LIMITS["DEFAULT"].maxRequests).toBe(200);
    expect(RATE_LIMITS["DEFAULT"].windowSecs).toBe(60);
  });

  it("requests 1-5 on POST /auth/agency/login → allowed", async () => {
    for (let i = 1; i <= 5; i++) {
      const result = await checkRateLimit("10.0.0.1", "POST", "/auth/agency/login");
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
    }
  });

  it("6th request on POST /auth/agency/login → blocked (429)", async () => {
    for (let i = 1; i <= 5; i++) await checkRateLimit("10.0.0.2", "POST", "/auth/agency/login");
    const result = await checkRateLimit("10.0.0.2", "POST", "/auth/agency/login");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("middleware returns 429 on 6th login attempt", async () => {
    for (let i = 1; i <= 5; i++) {
      const { req, res, next } = mockReqRes("POST", "/auth/agency/login", "10.0.0.3");
      await rateLimitMiddleware(req as never, res as never, next);
    }
    const { req, res, next } = mockReqRes("POST", "/auth/agency/login", "10.0.0.3");
    await rateLimitMiddleware(req as never, res as never, next);
    expect(res._status).toBe(429);
    expect((res._body as Record<string, string>)?.error).toBe("Too Many Requests");
    expect(next).not.toHaveBeenCalled();
  });

  it("rate limit headers present on allowed request", async () => {
    const { req, res, next } = mockReqRes("GET", "/api/something", "10.0.0.4");
    await rateLimitMiddleware(req as never, res as never, next);
    expect(res._headers["X-RateLimit-Limit"]).toBeDefined();
    expect(res._headers["X-RateLimit-Remaining"]).toBeDefined();
    expect(res._headers["X-RateLimit-Reset"]).toBeDefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("4th trekker/register → blocked", async () => {
    for (let i = 1; i <= 3; i++) await checkRateLimit("10.0.0.5", "POST", "/auth/trekker/register");
    const result = await checkRateLimit("10.0.0.5", "POST", "/auth/trekker/register");
    expect(result.allowed).toBe(false);
  });

  it("different IPs have independent counters", async () => {
    for (let i = 1; i <= 5; i++) await checkRateLimit("ip-A", "POST", "/auth/agency/login");
    const resultA = await checkRateLimit("ip-A", "POST", "/auth/agency/login");
    const resultB = await checkRateLimit("ip-B", "POST", "/auth/agency/login");
    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });

  // ── SOS exempt ────────────────────────────────────────────────────────────

  it("SOS_PATHS contains /sos, /api/sos, /emergency", () => {
    expect(SOS_PATHS).toContain("/sos");
    expect(SOS_PATHS).toContain("/api/sos");
    expect(SOS_PATHS).toContain("/emergency");
  });

  it("POST /sos is exempt from rate limiting regardless of count", async () => {
    for (let i = 1; i <= 20; i++) {
      const result = await checkRateLimit("10.0.0.6", "POST", "/sos");
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(999);
    }
  });

  it("POST /api/sos is exempt", async () => {
    const result = await checkRateLimit("10.0.0.7", "POST", "/api/sos");
    expect(result.allowed).toBe(true);
  });

  it("POST /emergency is exempt", async () => {
    const result = await checkRateLimit("10.0.0.8", "POST", "/emergency");
    expect(result.allowed).toBe(true);
  });

  it("middleware skips Redis entirely for SOS paths", async () => {
    const { redis } = await import("../src/lib/redis");
    const { req, res, next } = mockReqRes("POST", "/sos", "10.0.0.9");
    await rateLimitMiddleware(req as never, res as never, next);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("Redis down → fail open, request allowed", async () => {
    const { redis } = await import("../src/lib/redis");
    vi.mocked(redis.incr).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await checkRateLimit("10.0.0.10", "GET", "/api/data");
    expect(result.allowed).toBe(true);
  });
});