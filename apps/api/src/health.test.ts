import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/funtush_test");


const { mockDbQuery, mockRedisPing } = vi.hoisted(() => ({
  mockDbQuery:   vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  mockRedisPing: vi.fn().mockResolvedValue("PONG"),
}));

vi.mock("@funtush/database", () => ({
  db: {
    $queryRaw: (...args: unknown[]) => mockDbQuery(...args),
  },
  redis: { ping: mockRedisPing },
}));

vi.mock("./packages/database/prisma", () => ({
  prisma: {
    agency:          { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    subscription:    { count: vi.fn() },
    invoice:         { aggregate: vi.fn() },
    trek:            { count: vi.fn() },
    booking:         { aggregate: vi.fn() },
    breakGlassToken: { create: vi.fn() },
    domainMapping:   { findUnique: vi.fn() },
    kYCSubmission:   { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    $transaction:    vi.fn(),
  },
}));

vi.mock("./jobs/subscriptionExpiry.job", () => ({
  startSubscriptionCron: vi.fn(),
}));

vi.mock("./lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      insertOne: vi.fn(),
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
    }),
  }),
}));


vi.mock("./lib/redis", () => ({
  redis:   { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
  default: { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}));

vi.mock("../lib/fcm", () => ({
  getFcm: () => ({
    sendEachForMulticast: vi.fn().mockResolvedValue({ responses: [] }),
  }),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: app } = await import("./app");

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  if (server) server.close();
});


describe("GET /health", () => {
  it("returns 200 ok", async () => {
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