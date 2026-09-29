import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the public API (X-Api-Key auth) routes (API-wide
 * docs/test pass, Batch 6).
 */

const { authState, rateLimitState } = vi.hoisted(() => ({
  authState: { valid: false },
  rateLimitState: { allowed: true },
}));

vi.mock("../services/apiKey.service", () => ({
  authenticateApiKey: async (rawKey: string) => {
    if (!authState.valid || rawKey !== "funtush_live_valid") return null;
    return { agencyId: "agency-1", scope: "READ_ONLY", keyId: "key-1" };
  },
}));

vi.mock("../services/rateLimit.service", () => ({
  checkPublicApiRateLimit: async () => ({
    allowed: rateLimitState.allowed,
    limit: 100,
    remaining: rateLimitState.allowed ? 99 : 0,
    resetInSec: 60,
  }),
}));

const listPublicPackages = vi.fn();
const listPublicBookings = vi.fn();
vi.mock("../services/publicApi.service", () => ({
  listPublicPackages: (...a: unknown[]) => listPublicPackages(...a),
  listPublicBookings: (...a: unknown[]) => listPublicBookings(...a),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: publicApiRoutes } = await import("./publicApi.routes");

  const app = express();
  app.use(express.json());
  app.use("/", publicApiRoutes);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(() => {
  if (server) server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.valid = false;
  rateLimitState.allowed = true;
  listPublicPackages.mockResolvedValue({ data: [], total: 0 });
  listPublicBookings.mockResolvedValue({ data: [], total: 0 });
});

describe("auth", () => {
  it("401s both routes without an X-Api-Key header", async () => {
    expect((await fetch(`${baseUrl}/packages`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/bookings`)).status).toBe(401);
  });

  it("401s an invalid API key", async () => {
    const res = await fetch(`${baseUrl}/packages`, { headers: { "x-api-key": "funtush_live_wrong" } });
    expect(res.status).toBe(401);
  });
});

describe("with a valid API key", () => {
  beforeEach(() => {
    authState.valid = true;
  });

  it("GET /packages scopes to the key's own agency and sets rate-limit headers", async () => {
    const res = await fetch(`${baseUrl}/packages`, { headers: { "x-api-key": "funtush_live_valid" } });
    expect(res.status).toBe(200);
    expect(listPublicPackages).toHaveBeenCalledWith("agency-1", 1, 20);
    expect(res.headers.get("x-ratelimit-limit")).toBe("100");
  });

  it("GET /bookings passes through query params", async () => {
    const res = await fetch(`${baseUrl}/bookings?status=CONFIRMED&page=2&limit=10`, {
      headers: { "x-api-key": "funtush_live_valid" },
    });
    expect(res.status).toBe(200);
    expect(listPublicBookings).toHaveBeenCalledWith("agency-1", 2, 10, "CONFIRMED");
  });

  it("429s once the rate limit is exceeded, before the service is called", async () => {
    rateLimitState.allowed = false;
    const res = await fetch(`${baseUrl}/packages`, { headers: { "x-api-key": "funtush_live_valid" } });
    expect(res.status).toBe(429);
    expect(listPublicPackages).not.toHaveBeenCalled();
  });
});
