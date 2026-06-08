import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Ensure Redis environment validation passes before the app imports shared modules.
vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");

// Mock the data layer so /health can be exercised without live PostgreSQL or
// Redis. `vi.hoisted` ensures these mocks exist before the (hoisted) import of
// ./index.js pulls in the mocked @funtush/database module.
const { mockDbQuery, mockRedisPing } = vi.hoisted(() => ({
  mockDbQuery: vi.fn(),
  mockRedisPing: vi.fn(),
}));

vi.mock("@funtush/database", () => ({
  db: { query: mockDbQuery },
  redis: { ping: mockRedisPing },
}));

let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const module = await import("./index.js");
  app = module.app;

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe("GET /health", () => {
  it("returns 200 ok when DB and Redis are reachable", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockRedisPing.mockResolvedValueOnce("PONG");

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });

  it("returns 503 when a dependency is down", async () => {
    mockDbQuery.mockRejectedValueOnce(new Error("connection refused"));
    mockRedisPing.mockResolvedValueOnce("PONG");

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "error", db: "error", redis: "ok" });
  });
});
