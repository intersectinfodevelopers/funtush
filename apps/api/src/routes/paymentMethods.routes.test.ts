import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the payment-methods routes (API-wide docs/test pass,
 * Batch 3). `db` is mocked here (routing/guard/shape only) — real encryption
 * + real-DB round-tripping is covered separately in
 * `paymentMethods.integration.test.ts`.
 */

const { authState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
}));

vi.mock("src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.agencyId) return res.status(401).json({ message: "Refresh token is required" });
    req.agencyId = authState.agencyId;
    next();
  },
}));

const statusGuardSpy = vi.fn();
vi.mock("src/middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (_req: unknown, _res: unknown, next: () => void) => {
    statusGuardSpy();
    next();
  },
}));

const dbMock = {
  agencyPaymentMethod: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@funtush/database", () => ({ db: dbMock }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: paymentMethodsRoutes } = await import("./paymentMethods");

  const app = express();
  app.use(express.json());
  app.use("/", paymentMethodsRoutes);

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
  authState.agencyId = undefined;
  dbMock.agencyPaymentMethod.upsert.mockResolvedValue({
    id: "pm1", provider: "STRIPE", isActive: true, createdAt: new Date(),
  });
  dbMock.agencyPaymentMethod.findMany.mockResolvedValue([{ id: "pm1", provider: "STRIPE", isActive: true }]);
  dbMock.agencyPaymentMethod.findFirst.mockResolvedValue({ id: "pm1", agencyId: "agency-1", isActive: true });
  dbMock.agencyPaymentMethod.update.mockResolvedValue({ id: "pm1", provider: "STRIPE", isActive: false });
});

function authed() {
  return { "x-refresh-token": "tok" };
}

describe("auth", () => {
  it("401s all 3 endpoints without a token", async () => {
    expect((await fetch(`${baseUrl}/`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/pm1/toggle`, { method: "PATCH" })).status).toBe(401);
  });
});

describe("POST /", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("runs the status guard", async () => {
    await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ provider: "STRIPE", apiKey: "sk_test_x" }),
    });
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("requires a provider", async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ apiKey: "sk_test_x" }),
    });
    expect(res.status).toBe(400);
  });

  it("saves credentials and never returns them in the response", async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ provider: "STRIPE", apiKey: "sk_test_secret_value" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("credentialsEncrypted");
    expect(JSON.stringify(body)).not.toContain("sk_test_secret_value");

    const call = dbMock.agencyPaymentMethod.upsert.mock.calls[0][0];
    expect(call.create.credentialsEncrypted).not.toContain("sk_test_secret_value");
  });
});

describe("GET /", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("lists the agency's payment methods without credentials", async () => {
    const res = await fetch(`${baseUrl}/`, { headers: authed() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ provider: string }>;
    expect(body[0].provider).toBe("STRIPE");
    expect(dbMock.agencyPaymentMethod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agencyId: "agency-1" } }),
    );
  });
});

describe("PATCH /:id/toggle", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("toggles isActive", async () => {
    const res = await fetch(`${baseUrl}/pm1/toggle`, { method: "PATCH", headers: authed() });
    expect(res.status).toBe(200);
    expect(dbMock.agencyPaymentMethod.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it("404s when the method doesn't belong to this agency", async () => {
    dbMock.agencyPaymentMethod.findFirst.mockResolvedValue(null);
    const res = await fetch(`${baseUrl}/pm1/toggle`, { method: "PATCH", headers: authed() });
    expect(res.status).toBe(404);
  });
});
