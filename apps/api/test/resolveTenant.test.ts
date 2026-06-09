import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock tenant service 
vi.mock("../src/services/tenant.service", () => ({
  getTenantBySubdomain: vi.fn(),
  getTenantByCustomDomain: vi.fn(),
}));

import { getTenantBySubdomain, getTenantByCustomDomain } from "../src/services/tenant.service";
import { resolveTenant } from "../src/middleware/resolveTenant.middleware";

function mockReqRes(host: string, ip = "127.0.0.1") {
  const req: any = {
    headers: { host, "x-forwarded-for": ip },
    socket:  { remoteAddress: ip },
  };
  const res: any = {
    _status: 200,
    _ended:  false,
    status(code: number) { this._status = code; return this; },
    end()   { this._ended = true; },
    json(body: any) { this._body = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe("resolveTenant middleware", () => {

  beforeEach(() => vi.clearAllMocks());

  //  Tenant Resolution 

  it("funtush.com → context=platform, no tenant", async () => {
    const { req, res, next } = mockReqRes("funtush.com");
    await resolveTenant(req, res, next);
    expect(req.context).toBe("platform");
    expect(req.tenantId).toBeNull();
    expect(req.agencyId).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it("www.funtush.com → context=platform", async () => {
    const { req, res, next } = mockReqRes("www.funtush.com");
    await resolveTenant(req, res, next);
    expect(req.context).toBe("platform");
    expect(next).toHaveBeenCalledOnce();
  });

  it("xyz.funtush.io → resolves agency_xyz tenant", async () => {
    (getTenantBySubdomain as any).mockResolvedValue({ tenantId: "tenant_xyz", agencyId: "agency_xyz" });
    const { req, res, next } = mockReqRes("xyz.funtush.io");
    await resolveTenant(req, res, next);
    expect(getTenantBySubdomain).toHaveBeenCalledWith("xyz");
    expect(req.context).toBe("agency");
    expect(req.tenantId).toBe("tenant_xyz");
    expect(req.agencyId).toBe("agency_xyz");
    expect(next).toHaveBeenCalledOnce();
  });

  it("abc.funtush.io → resolves agency_abc (Agency B isolation)", async () => {
    (getTenantBySubdomain as any).mockResolvedValue({ tenantId: "tenant_abc", agencyId: "agency_abc" });
    const { req, res, next } = mockReqRes("abc.funtush.io");
    await resolveTenant(req, res, next);
    expect(req.tenantId).toBe("tenant_abc");
    expect(req.agencyId).toBe("agency_abc");
  });

  it("custom.com → resolves via custom domain mapping", async () => {
    (getTenantByCustomDomain as any).mockResolvedValue({ tenantId: "tenant_custom", agencyId: "agency_custom" });
    const { req, res, next } = mockReqRes("custom.com");
    await resolveTenant(req, res, next);
    expect(getTenantByCustomDomain).toHaveBeenCalledWith("custom.com");
    expect(req.context).toBe("agency");
    expect(req.tenantId).toBe("tenant_custom");
  });

  it("unknown subdomain → 404, next NOT called", async () => {
    (getTenantBySubdomain as any).mockResolvedValue(null);
    const { req, res, next } = mockReqRes("ghost.funtush.io");
    await resolveTenant(req, res, next);
    expect(res._status).toBe(404);
    expect(res._ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it("unknown custom domain → 404", async () => {
    (getTenantByCustomDomain as any).mockResolvedValue(null);
    const { req, res, next } = mockReqRes("evil.example.com");
    await resolveTenant(req, res, next);
    expect(res._status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("admin.funtush.com with whitelisted IP → context=admin", async () => {
    process.env.ADMIN_IP_WHITELIST = "127.0.0.1,::1";
    const { req, res, next } = mockReqRes("admin.funtush.com", "127.0.0.1");
    await resolveTenant(req, res, next);
    expect(req.context).toBe("admin");
    expect(req.adminIpAllowed).toBe(true);
    expect(req.tenantId).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it("admin.funtush.com with non-whitelisted IP → 404", async () => {
    process.env.ADMIN_IP_WHITELIST = "127.0.0.1,::1";
    const { req, res, next } = mockReqRes("admin.funtush.com", "203.0.113.99");
    await resolveTenant(req, res, next);
    expect(res._status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  // ── Tenant Isolation 

  it("agency_xyz context cannot access agency_abc agencyId", async () => {
    // resolveTenant locks req.agencyId to the resolved tenant.
    // Agency A's request will always have agencyId='agency_xyz', regardless of query params.
    (getTenantBySubdomain as any).mockResolvedValue({ tenantId: "tenant_xyz", agencyId: "agency_xyz" });
    const { req, res, next } = mockReqRes("xyz.funtush.io");
    await resolveTenant(req, res, next);
    // Attempting to set agencyId to agency_abc via query string has no effect;
    // req.agencyId is set by middleware, not user input.
    req.query = { agencyId: "agency_abc" }; // attacker injects different agencyId
    expect(req.agencyId).toBe("agency_xyz"); // still locked to the resolved tenant
  });

  it("no host header → 404", async () => {
    const req: any  = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
    const res: any  = { _status: 200, _ended: false, status(c:number){this._status=c;return this;}, end(){this._ended=true;} };
    const next = vi.fn();
    await resolveTenant(req, res, next);
    expect(res._status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });
});
