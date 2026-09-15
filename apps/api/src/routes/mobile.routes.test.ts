import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the mobile API routes (API-wide docs/test pass,
 * Batch 5) — previously zero coverage of any kind despite already being
 * correctly guarded. Proves the role gates the file's own extensive
 * comments describe (trekker-only, guide/staff-only, broad-role, and
 * auth-only-no-role) actually behave as documented.
 */

const { authState } = vi.hoisted(() => ({
  authState: { role: undefined as string | undefined },
}));

vi.mock("@funtush/auth", () => ({
  requireAuth: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.role) return res.status(401).json({ message: "No token provided" });
    req.user = { userId: "user-1", role: authState.role, roleType: "TENANT" };
    next();
  },
  requireRole:
    (allowed: string[]) =>
    (
      req: { user?: { role?: string } },
      res: { status: (c: number) => { json: (b: unknown) => void } },
      next: () => void,
    ) => {
      if (!req.user || !allowed.includes(req.user.role ?? "")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      next();
    },
}));

const trekkerDashboardController = vi.fn((_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
const guideDashboardController = vi.fn((_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
vi.mock("../controllers/mobile.controller", () => ({
  trekkerDashboardController: (...a: unknown[]) => (trekkerDashboardController as unknown as (...a: unknown[]) => void)(...a),
  guideDashboardController: (...a: unknown[]) => (guideDashboardController as unknown as (...a: unknown[]) => void)(...a),
}));

const offlinePackageController = vi.fn((_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
const offlinePackageVersionController = vi.fn((_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
vi.mock("../controllers/offlinePackage.controller", () => ({
  offlinePackageController: (...a: unknown[]) => (offlinePackageController as unknown as (...a: unknown[]) => void)(...a),
  offlinePackageVersionController: (...a: unknown[]) =>
    (offlinePackageVersionController as unknown as (...a: unknown[]) => void)(...a),
}));

const registerDeviceController = vi.fn((_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
const unregisterDeviceController = vi.fn((_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
vi.mock("../controllers/deviceToken.controller", () => ({
  registerDeviceController: (...a: unknown[]) => (registerDeviceController as unknown as (...a: unknown[]) => void)(...a),
  unregisterDeviceController: (...a: unknown[]) =>
    (unregisterDeviceController as unknown as (...a: unknown[]) => void)(...a),
}));

const emergencyNumbersController = vi.fn((_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
const emergencyNumbersVersionController = vi.fn((_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
vi.mock("../controllers/emergencyNumbers.controller", () => ({
  emergencyNumbersController: (...a: unknown[]) => (emergencyNumbersController as unknown as (...a: unknown[]) => void)(...a),
  emergencyNumbersVersionController: (...a: unknown[]) =>
    (emergencyNumbersVersionController as unknown as (...a: unknown[]) => void)(...a),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: mobileRoutes } = await import("./mobile.routes");

  const app = express();
  app.use(express.json());
  app.use("/", mobileRoutes);

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
  authState.role = undefined;
});

describe("auth", () => {
  it("401s every route without a token", async () => {
    expect((await fetch(`${baseUrl}/trekker/dashboard`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/guide/dashboard`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/bookings/b1/offline-package`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/register-device`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/emergency-numbers`)).status).toBe(401);
  });
});

describe("role gates", () => {
  it("trekker/dashboard is TREKKER-only", async () => {
    authState.role = "GUIDE";
    expect((await fetch(`${baseUrl}/trekker/dashboard`, { headers: { Authorization: "Bearer x" } })).status).toBe(403);

    authState.role = "TREKKER";
    const res = await fetch(`${baseUrl}/trekker/dashboard`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    expect(trekkerDashboardController).toHaveBeenCalledTimes(1);
  });

  it("guide/dashboard accepts GUIDE and STAFF, rejects TREKKER", async () => {
    authState.role = "TREKKER";
    expect((await fetch(`${baseUrl}/guide/dashboard`, { headers: { Authorization: "Bearer x" } })).status).toBe(403);

    authState.role = "STAFF";
    expect((await fetch(`${baseUrl}/guide/dashboard`, { headers: { Authorization: "Bearer x" } })).status).toBe(200);
  });

  it("offline-package routes accept the broad OFFLINE_PACKAGE_ROLES set", async () => {
    authState.role = "AGENCY_ADMIN";
    const res = await fetch(`${baseUrl}/bookings/b1/offline-package`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    expect(offlinePackageController).toHaveBeenCalledTimes(1);
  });

  it("offline-package/version is checked before /offline-package (route order)", async () => {
    authState.role = "TREKKER";
    const res = await fetch(`${baseUrl}/bookings/b1/offline-package/version`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    expect(offlinePackageVersionController).toHaveBeenCalledTimes(1);
    expect(offlinePackageController).not.toHaveBeenCalled();
  });
});

describe("device + emergency-numbers routes — auth only, no role restriction", () => {
  it.each(["TREKKER", "GUIDE", "STAFF", "SUPER_ADMIN"])("register-device works for role %s", async (role) => {
    authState.role = role;
    const res = await fetch(`${baseUrl}/register-device`, { method: "POST", headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
  });

  it("DELETE /register-device unregisters", async () => {
    authState.role = "TREKKER";
    const res = await fetch(`${baseUrl}/register-device`, { method: "DELETE", headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    expect(unregisterDeviceController).toHaveBeenCalledTimes(1);
  });

  it("emergency-numbers/version is checked before /emergency-numbers", async () => {
    authState.role = "TREKKER";
    const res = await fetch(`${baseUrl}/emergency-numbers/version`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    expect(emergencyNumbersVersionController).toHaveBeenCalledTimes(1);
    expect(emergencyNumbersController).not.toHaveBeenCalled();
  });

  it("GET /emergency-numbers works for any authenticated role", async () => {
    authState.role = "GUIDE";
    const res = await fetch(`${baseUrl}/emergency-numbers`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    expect(emergencyNumbersController).toHaveBeenCalledTimes(1);
  });
});
