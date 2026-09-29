import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the SOS trigger/cancel routes (API-wide docs/test
 * pass, Batch 5).
 *
 * Regression test for a real, safety-critical vulnerability: both routes
 * had **no auth at all** — anyone could anonymously fake-trigger an
 * emergency alert, or cancel a real one for a trekker actually in danger.
 * `requireAuth` was added, matching `mobile.routes.ts`'s own documented
 * convention for SOS (Backend Guide §10).
 */

const { authState } = vi.hoisted(() => ({
  authState: { valid: false },
}));

vi.mock("@funtush/auth", () => ({
  requireAuth: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.valid) return res.status(401).json({ message: "No token provided" });
    req.user = { userId: "user-1", role: "GUIDE", roleType: "TENANT" };
    next();
  },
}));

const triggerSOS = vi.fn();
const cancelSOS = vi.fn();

vi.mock("../services/emergencyService", () => ({
  emergencyService: {
    triggerSOS: (...a: unknown[]) => triggerSOS(...a),
    cancelSOS: (...a: unknown[]) => cancelSOS(...a),
  },
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: sosRoutes } = await import("./sosRoutes");

  const app = express();
  app.use(express.json());
  app.use("/", sosRoutes);

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
  triggerSOS.mockResolvedValue(undefined);
  cancelSOS.mockResolvedValue(undefined);
});

describe("without auth — the vulnerability this file guards", () => {
  it("401s POST /trigger", async () => {
    const res = await fetch(`${baseUrl}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trekId: "t1", sosType: "MEDICAL", location: "27.7,85.3" }),
    });
    expect(res.status).toBe(401);
    expect(triggerSOS).not.toHaveBeenCalled();
  });

  it("401s POST /:sosId/cancel", async () => {
    const res = await fetch(`${baseUrl}/sos-1/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "False alarm" }),
    });
    expect(res.status).toBe(401);
    expect(cancelSOS).not.toHaveBeenCalled();
  });
});

describe("with a valid session", () => {
  beforeEach(() => {
    authState.valid = true;
  });

  it("POST /trigger requires trekId/sosType/location", async () => {
    const res = await fetch(`${baseUrl}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /trigger activates and falls back to the caller's userId as guiderId", async () => {
    const res = await fetch(`${baseUrl}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trekId: "t1", sosType: "MEDICAL", location: "27.7,85.3" }),
    });
    expect(res.status).toBe(200);
    expect(triggerSOS).toHaveBeenCalledWith(
      expect.objectContaining({ trekId: "t1", sosType: "MEDICAL", guiderId: "user-1" }),
    );
  });

  it("POST /:sosId/cancel requires a reason", async () => {
    const res = await fetch(`${baseUrl}/sos-1/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:sosId/cancel cancels with a reason", async () => {
    const res = await fetch(`${baseUrl}/sos-1/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "False alarm" }),
    });
    expect(res.status).toBe(200);
    expect(cancelSOS).toHaveBeenCalledWith("sos-1", "False alarm");
  });
});
