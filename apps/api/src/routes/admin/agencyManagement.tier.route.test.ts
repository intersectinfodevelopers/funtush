import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * PATCH /admin/agencies/:id/tier and /status — QA "known issue": an unknown tier name (or agency id) came back as a
 * bare 500. Those are the caller's mistakes: 400 for an unknown tier, 404 for an unknown agency.
 */

interface TestUser {
  userId: string;
  role: string;
  roleType: string;
}
const { authState } = vi.hoisted(() => ({ authState: { user: null as TestUser | null } }));

vi.mock("@funtush/auth", () => ({
  requireAuth: (
    req: { user?: TestUser },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.user) return res.status(401).json({ error: "Authentication required" });
    req.user = authState.user;
    next();
  },
}));

const updateAgencyTier = vi.fn();
const updateAgencyStatus = vi.fn();
vi.mock("../../services/adminAgency.service", () => ({
  listAgencies: vi.fn(),
  getAgencyProfile: vi.fn(),
  updateAgencyTier: (...args: unknown[]) => updateAgencyTier(...args),
  updateAgencyStatus: (...args: unknown[]) => updateAgencyStatus(...args),
  impersonateAgency: vi.fn(),
  revokeImpersonation: vi.fn(),
  updateAgencyPriorityOverride: vi.fn(),
}));
vi.mock("../../services/auditLog.service", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../services/supportHandoff.service", () => ({ createSupportHandoff: vi.fn() }));
vi.mock("../../services/breakGlass.service", () => ({ issueBreakGlassToken: vi.fn(), revokeBreakGlass: vi.fn() }));
vi.mock("../../middleware/requireAdmin.middleware", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../middleware/requirePlatformPermission.middleware", () => ({
  requirePlatformPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../utils/email", () => ({ sendSupportAccessNotificationEmail: vi.fn() }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: router } = await import("./agencyManagement.route");
  const app = express();
  app.use(express.json());
  app.use("/", router);
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
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  authState.user = { userId: "admin-1", role: "SUPER_ADMIN", roleType: "PLATFORM" };
});

const patch = (path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("PATCH /:id/tier", () => {
  it("400s an unknown tier with the reason, not 500", async () => {
    updateAgencyTier.mockRejectedValue(new Error("Unknown tier: GOLD"));
    const res = await patch("/agency-1/tier", { tier: "GOLD" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown tier: GOLD" });
  });

  it("404s an unknown agency (database 'record not found'), not 500", async () => {
    updateAgencyTier.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    const res = await patch("/missing/tier", { tier: "MEDIUM" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Agency not found" });
  });

  it("400s a missing tier", async () => {
    const res = await patch("/agency-1/tier", {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "tier is required" });
    expect(updateAgencyTier).not.toHaveBeenCalled();
  });

  it("updates a valid tier", async () => {
    updateAgencyTier.mockResolvedValue({ id: "agency-1", tier: { name: "MEDIUM" } });
    const res = await patch("/agency-1/tier", { tier: " MEDIUM " });
    expect(res.status).toBe(200);
    expect(updateAgencyTier).toHaveBeenCalledWith("agency-1", "MEDIUM");
  });

  it("still 500s a genuine failure, without leaking its message", async () => {
    updateAgencyTier.mockRejectedValue(new Error("connection to 10.0.0.5 refused"));
    const res = await patch("/agency-1/tier", { tier: "MEDIUM" });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("10.0.0.5");
  });

  it("is still super / platform admin only", async () => {
    authState.user = { userId: "u", role: "PLATFORM_SUPPORT", roleType: "PLATFORM" };
    const res = await patch("/agency-1/tier", { tier: "MEDIUM" });
    expect(res.status).toBe(403);
    expect(updateAgencyTier).not.toHaveBeenCalled();
  });
});

describe("PATCH /:id/status", () => {
  it("404s an unknown agency, not 500", async () => {
    updateAgencyStatus.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    const res = await patch("/missing/status", { status: "SUSPENDED", reason: "fraud review" });
    expect(res.status).toBe(404);
  });

  it("400s an invalid status and a missing reason (unchanged)", async () => {
    expect((await patch("/agency-1/status", { status: "BANNED", reason: "x" })).status).toBe(400);
    expect((await patch("/agency-1/status", { status: "ACTIVE" })).status).toBe(400);
  });
});
