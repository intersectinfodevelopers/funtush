import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");


const { mockDbQuery, mockRedisPing } = vi.hoisted(() => ({
  mockDbQuery: vi.fn(),
  mockRedisPing: vi.fn(),
}));

vi.mock("@funtush/database", () => ({
  db: {
    $queryRaw: mockDbQuery, // Prisma-style DB call
  },
  redis: {
    ping: mockRedisPing,
  },
}) as unknown as typeof import("@funtush/database"));

type AppModule = typeof import("./index.js");

let app: AppModule["app"];
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
    mockDbQuery.mockResolvedValueOnce([{ "?column?": 1 }]);
    mockRedisPing.mockResolvedValueOnce("PONG");

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      db: "ok",
      redis: "ok",
    });
  });

  it("returns 503 when a dependency is down", async () => {
    mockDbQuery.mockRejectedValueOnce(new Error("connection refused"));
    mockRedisPing.mockResolvedValueOnce("PONG");

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({
      status: "error",
      db: "error",
      redis: "ok",
    });
  });
});