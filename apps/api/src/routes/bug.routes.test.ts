import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the bug-report routes (API-wide docs/test pass,
 * Batch 3). Service-mocked. This router is mounted twice in app.ts
 * (`/agencies/me/bugs` and `/admin/bugs`, same router) — mounted once here
 * since the routing logic under test is identical either way.
 */

const { authState } = vi.hoisted(() => ({
  authState: { role: undefined as string | undefined, roleType: undefined as string | undefined },
}));

vi.mock("@funtush/auth", () => ({
  requireAuth: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.role) return res.status(401).json({ message: "No token provided" });
    req.user = { userId: "user-1", agencyId: "agency-1", role: authState.role, roleType: authState.roleType };
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

vi.mock("../middleware/requireSuperAdminRole.middleware", () => ({
  requireSuperAdminRole: (
    req: { user?: { role?: string; roleType?: string } },
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (req.user?.roleType !== "PLATFORM" || !["SUPER_ADMIN", "PLATFORM_ADMIN"].includes(req.user?.role ?? "")) {
      return res.status(403).json({ error: "Requires platform admin privileges" });
    }
    next();
  },
}));

const submitBug = vi.fn();
const getAgencyBugs = vi.fn();
const setBugPriority = vi.fn();
const assignBug = vi.fn();
const addBugHint = vi.fn();
const resolveBug = vi.fn();

vi.mock("../services/bugReport.service", () => ({
  submitBug: (...a: unknown[]) => submitBug(...a),
  getAgencyBugs: (...a: unknown[]) => getAgencyBugs(...a),
  setBugPriority: (...a: unknown[]) => setBugPriority(...a),
  assignBug: (...a: unknown[]) => assignBug(...a),
  addBugHint: (...a: unknown[]) => addBugHint(...a),
  resolveBug: (...a: unknown[]) => resolveBug(...a),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: bugRoutes } = await import("./bug.routes");

  const app = express();
  app.use(express.json());
  app.use("/", bugRoutes);

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
  authState.roleType = undefined;
  submitBug.mockResolvedValue({ id: "bug1" });
  getAgencyBugs.mockResolvedValue({ data: [], total: 0 });
  setBugPriority.mockResolvedValue({ id: "bug1", priority: "HIGH" });
  assignBug.mockResolvedValue({ id: "bug1" });
  addBugHint.mockResolvedValue({ id: "hint1" });
  resolveBug.mockResolvedValue({ id: "bug1", status: "RESOLVED" });
});

describe("agency endpoints", () => {
  it("401s without a bearer token", async () => {
    expect((await fetch(`${baseUrl}/`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/`)).status).toBe(401);
  });

  it("403s a non-AGENCY_ADMIN role", async () => {
    authState.role = "STAFF";
    authState.roleType = "TENANT";
    const res = await fetch(`${baseUrl}/`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(403);
  });

  it("submits a bug report", async () => {
    authState.role = "AGENCY_ADMIN";
    authState.roleType = "TENANT";
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer x" },
      body: JSON.stringify({ title: "Broken button", description: "It's broken" }),
    });
    expect(res.status).toBe(201);
    expect(submitBug).toHaveBeenCalledWith("agency-1", expect.objectContaining({ title: "Broken button" }));
  });

  it("lists the agency's bugs", async () => {
    authState.role = "AGENCY_ADMIN";
    authState.roleType = "TENANT";
    const res = await fetch(`${baseUrl}/`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
    expect(getAgencyBugs).toHaveBeenCalledWith("agency-1", undefined, 1, 20);
  });

  // Regression test: GET "/" previously allowed only AGENCY_ADMIN, so
  // GET /admin/bugs — the same route, reached via the other mount — 403'd
  // for every real platform admin. Confirmed against a real SUPER_ADMIN JWT
  // while wiring up the admin panel's Bug Triage page.
  it("a platform SUPER_ADMIN can also list (the /admin/bugs mount)", async () => {
    authState.role = "SUPER_ADMIN";
    authState.roleType = "PLATFORM";
    const res = await fetch(`${baseUrl}/`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(200);
  });
});

describe("admin (super-admin-only) endpoints", () => {
  it("403s a plain AGENCY_ADMIN", async () => {
    authState.role = "AGENCY_ADMIN";
    authState.roleType = "TENANT";
    const res = await fetch(`${baseUrl}/bug1/priority`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: "Bearer x" },
      body: JSON.stringify({ priority: "HIGH" }),
    });
    expect(res.status).toBe(403);
  });

  it("allows a SUPER_ADMIN to set priority", async () => {
    authState.role = "SUPER_ADMIN";
    authState.roleType = "PLATFORM";
    const res = await fetch(`${baseUrl}/bug1/priority`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: "Bearer x" },
      body: JSON.stringify({ priority: "HIGH" }),
    });
    expect(res.status).toBe(200);
    expect(setBugPriority).toHaveBeenCalledWith("bug1", "HIGH");
  });

  it("resolve surfaces 409 when already resolved", async () => {
    authState.role = "SUPER_ADMIN";
    authState.roleType = "PLATFORM";
    resolveBug.mockRejectedValue(new Error("Bug is already resolved"));
    const res = await fetch(`${baseUrl}/bug1/resolve`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: "Bearer x" },
      body: JSON.stringify({ resolutionNote: "Fixed" }),
    });
    expect(res.status).toBe(409);
  });

  it("addBugHint 201s and passes the caller's userId", async () => {
    authState.role = "PLATFORM_ADMIN";
    authState.roleType = "PLATFORM";
    const res = await fetch(`${baseUrl}/bug1/hint`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer x" },
      body: JSON.stringify({ note: "Looks like a race condition" }),
    });
    expect(res.status).toBe(201);
    expect(addBugHint).toHaveBeenCalledWith("bug1", "user-1", "Looks like a race condition");
  });
});
