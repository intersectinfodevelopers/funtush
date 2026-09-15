import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the branches/staff/guide/package-branch routes
 * (API-wide docs/test pass, Batch 3). Service-mocked, same pattern as
 * `instagram.routes.test.ts` — proves routing and the auth guard; the
 * service layer's own business logic is out of scope here.
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
    req.tenantId = authState.agencyId;
    req.agencyId = authState.agencyId;
    next();
  },
}));

const createBranchService = vi.fn();
const updateBranchService = vi.fn();
const getBranchesService = vi.fn();
const assignStaffToBranchService = vi.fn();
const assignGuideToBranchService = vi.fn();
const assignPackageToBranchService = vi.fn();
const getBranchReportService = vi.fn();
const getConsolidatedFinanceService = vi.fn();

vi.mock("src/services/branches.service", () => ({
  createBranchService: (...a: unknown[]) => createBranchService(...a),
  updateBranchService: (...a: unknown[]) => updateBranchService(...a),
  getBranchesService: (...a: unknown[]) => getBranchesService(...a),
  assignStaffToBranchService: (...a: unknown[]) => assignStaffToBranchService(...a),
  assignGuideToBranchService: (...a: unknown[]) => assignGuideToBranchService(...a),
  assignPackageToBranchService: (...a: unknown[]) => assignPackageToBranchService(...a),
  getBranchReportService: (...a: unknown[]) => getBranchReportService(...a),
  getConsolidatedFinanceService: (...a: unknown[]) => getConsolidatedFinanceService(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: branchesRoutes } = await import("./branches.routes");

  const app = express();
  app.use(express.json());
  app.use("/", branchesRoutes);

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
  createBranchService.mockResolvedValue({ id: "b1" });
  updateBranchService.mockResolvedValue({ id: "b1", name: "Updated" });
  getBranchesService.mockResolvedValue([{ id: "b1" }]);
  assignStaffToBranchService.mockResolvedValue({ ok: true });
  assignGuideToBranchService.mockResolvedValue({ ok: true });
  assignPackageToBranchService.mockResolvedValue({ ok: true });
  getBranchReportService.mockResolvedValue({ revenue: 0 });
  getConsolidatedFinanceService.mockResolvedValue({ total: 0 });
});

function authed() {
  return { "x-refresh-token": "tok" };
}

describe("auth on every route", () => {
  it("401s all 7 endpoints without a token", async () => {
    expect((await fetch(`${baseUrl}/agencies/me/branches`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/branches`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/branches/b1`, { method: "PATCH" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/staff/s1/branch`, { method: "PATCH" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/guides/g1/branch`, { method: "PATCH" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/packages/p1/branches`, { method: "PATCH" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/branches/b1/report`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/finance/consolidated`)).status).toBe(401);
  });
});

describe("authenticated calls", () => {
  beforeEach(() => {
    authState.agencyId = "agencyuser-1";
  });

  it("GET /agencies/me/branches lists branches with a count", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/branches`, { headers: authed() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(1);
    expect(getBranchesService).toHaveBeenCalledWith("agencyuser-1");
  });

  it("POST /agencies/me/branches creates a branch", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/branches`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ name: "Pokhara" }),
    });
    expect(res.status).toBe(201);
    expect(createBranchService).toHaveBeenCalledWith("agencyuser-1", { name: "Pokhara" });
  });

  it("surfaces a service error as 400", async () => {
    createBranchService.mockRejectedValue(new Error("Branch name already exists"));
    const res = await fetch(`${baseUrl}/agencies/me/branches`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ name: "Dupe" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Branch name already exists");
  });

  it("PATCH /agencies/me/branches/:id updates a branch", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/branches/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(200);
    expect(updateBranchService).toHaveBeenCalledWith("agencyuser-1", "b1", { name: "Renamed" });
  });

  it("PATCH /agencies/me/staff/:id/branch assigns staff", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/staff/s1/branch`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ branchId: "b1" }),
    });
    expect(res.status).toBe(200);
    expect(assignStaffToBranchService).toHaveBeenCalledWith("agencyuser-1", "s1", { branchId: "b1" });
  });

  it("PATCH /guides/:id/branch assigns a guide", async () => {
    const res = await fetch(`${baseUrl}/guides/g1/branch`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ branchId: "b1" }),
    });
    expect(res.status).toBe(200);
    expect(assignGuideToBranchService).toHaveBeenCalledWith("agencyuser-1", "g1", { branchId: "b1" });
  });

  it("PATCH /packages/:id/branches sets package branches", async () => {
    const res = await fetch(`${baseUrl}/packages/p1/branches`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ branchIds: ["b1"] }),
    });
    expect(res.status).toBe(200);
    expect(assignPackageToBranchService).toHaveBeenCalledWith("agencyuser-1", "p1", { branchIds: ["b1"] });
  });

  it("GET /agencies/me/branches/:id/report returns a report", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/branches/b1/report`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(getBranchReportService).toHaveBeenCalledWith("agencyuser-1", "b1");
  });

  it("GET /agencies/me/finance/consolidated returns consolidated finance", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/finance/consolidated`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(getConsolidatedFinanceService).toHaveBeenCalledWith("agencyuser-1");
  });
});
