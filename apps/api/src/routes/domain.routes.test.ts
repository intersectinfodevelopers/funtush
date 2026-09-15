import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the domain routes (backend catch-up pass, Phase 6).
 * Same shape as `notificationPreferences.routes.test.ts`: real Express app on
 * a real socket, only auth/status-guard/paid-tier-guard/service mocked.
 *
 * `isPaidTier` is exercised as a togglable spy (`paidTierState.blocked`)
 * rather than trusted blindly, so these tests also prove which routes it
 * actually guards — connect/verify/disconnect, but not publish/unpublish.
 */

const { authState, paidTierState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
  paidTierState: { blocked: false },
}));

vi.mock("../middleware/refreshTokenAuthentication", () => ({
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
const paidTierSpy = vi.fn();

vi.mock("../middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (_req: unknown, _res: unknown, next: () => void) => {
    statusGuardSpy();
    next();
  },
  isPaidTier: (
    _req: unknown,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    paidTierSpy();
    if (paidTierState.blocked) {
      return res.status(403).json({
        success: false,
        message: "Custom domains are for the paid tiers. Please upgrade subscription.",
      });
    }
    next();
  },
}));

const getDomainSettings = vi.fn();
const connectDomain = vi.fn();
const disconnectDomain = vi.fn();
const verifyDomain = vi.fn();
const publishSite = vi.fn();
const unpublishSite = vi.fn();

vi.mock("../services/domain.service", () => ({
  getDomainSettings: (...a: unknown[]) => getDomainSettings(...a),
  connectDomain: (...a: unknown[]) => connectDomain(...a),
  disconnectDomain: (...a: unknown[]) => disconnectDomain(...a),
  verifyDomain: (...a: unknown[]) => verifyDomain(...a),
  publishSite: (...a: unknown[]) => publishSite(...a),
  unpublishSite: (...a: unknown[]) => unpublishSite(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const SETTINGS = {
  subdomain: "trekco",
  customDomain: null,
  status: "NONE",
  verifiedAt: null,
  dnsInstructions: null,
  published: false,
  publishedAt: null,
};

const CONNECTED = {
  ...SETTINGS,
  customDomain: "trekkingagency.com",
  status: "PENDING",
  dnsInstructions: {
    cname: { type: "CNAME", name: "www.trekkingagency.com", value: "trekco.funtush.io" },
    txt: { type: "TXT", name: "_funtush-verify.trekkingagency.com", value: "abc123" },
  },
};

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: domainRoutes } = await import("./domain.routes");

  const app = express();
  app.use(express.json());
  app.use("/", domainRoutes);

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
  paidTierState.blocked = false;
  getDomainSettings.mockResolvedValue(SETTINGS);
  connectDomain.mockResolvedValue(CONNECTED);
  disconnectDomain.mockResolvedValue(SETTINGS);
  verifyDomain.mockResolvedValue({ settings: CONNECTED, verified: false, detail: "No TXT record found yet." });
  publishSite.mockResolvedValue({ ...SETTINGS, published: true, publishedAt: new Date("2026-09-15T00:00:00.000Z") });
  unpublishSite.mockResolvedValue(SETTINGS);
});

function authHeaders(token?: string) {
  return token ? { "x-refresh-token": token } : {};
}

function getDomain(token?: string) {
  return fetch(`${baseUrl}/agencies/me/domain`, { headers: authHeaders(token) });
}

function patchDomain(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/domain`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });
}

function deleteDomain(token?: string) {
  return fetch(`${baseUrl}/agencies/me/domain`, { method: "DELETE", headers: authHeaders(token) });
}

function postVerify(token?: string) {
  return fetch(`${baseUrl}/agencies/me/domain/verify`, { method: "POST", headers: authHeaders(token) });
}

function postPublish(token?: string) {
  return fetch(`${baseUrl}/agencies/me/publish`, { method: "POST", headers: authHeaders(token) });
}

function postUnpublish(token?: string) {
  return fetch(`${baseUrl}/agencies/me/unpublish`, { method: "POST", headers: authHeaders(token) });
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

describe("auth on every domain endpoint", () => {
  it("401s every route without a token", async () => {
    expect((await getDomain()).status).toBe(401);
    expect((await patchDomain({ domain: "trekkingagency.com" })).status).toBe(401);
    expect((await deleteDomain()).status).toBe(401);
    expect((await postVerify()).status).toBe(401);
    expect((await postPublish()).status).toBe(401);
    expect((await postUnpublish()).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchDomain({ domain: "trekkingagency.com" });
    expect(connectDomain).not.toHaveBeenCalled();
  });
});

/* ── GET (no paid-tier gate, no status guard) ──────────────────────────── */

describe("GET /agencies/me/domain", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("returns the current settings", async () => {
    const res = await getDomain("tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof SETTINGS }>(res);
    expect(body.data.subdomain).toBe("trekco");
    expect(getDomainSettings).toHaveBeenCalledWith("agency-1");
  });

  it("does not run the paid-tier gate on the read", async () => {
    await getDomain("tok");
    expect(paidTierSpy).not.toHaveBeenCalled();
  });

  it("never caches a dashboard response", async () => {
    const res = await getDomain("tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── PATCH (connect) — paid-tier gated ─────────────────────────────────── */

describe("PATCH /agencies/me/domain", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("connects a valid domain", async () => {
    const res = await patchDomain({ domain: "trekkingagency.com" }, "tok");
    expect(res.status).toBe(200);
    expect(connectDomain).toHaveBeenCalledWith("agency-1", "trekkingagency.com");
  });

  it("runs the status guard and the paid-tier guard, in that order", async () => {
    await patchDomain({ domain: "trekkingagency.com" }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
    expect(paidTierSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks a FREE-tier agency with 403 before the service is called", async () => {
    paidTierState.blocked = true;

    const res = await patchDomain({ domain: "trekkingagency.com" }, "tok");
    expect(res.status).toBe(403);
    expect(connectDomain).not.toHaveBeenCalled();
  });

  it("rejects a malformed domain with 400 before the service is called", async () => {
    const res = await patchDomain({ domain: "not a domain" }, "tok");
    expect(res.status).toBe(400);
    expect(connectDomain).not.toHaveBeenCalled();
  });

  it("rejects https:// and a trailing slash with 400", async () => {
    const res = await patchDomain({ domain: "https://trekkingagency.com/" }, "tok");
    expect(res.status).toBe(400);
    expect(connectDomain).not.toHaveBeenCalled();
  });

  it("rejects an unknown top-level key with 400", async () => {
    const res = await patchDomain({ domain: "trekkingagency.com", agencyId: "other" }, "tok");
    expect(res.status).toBe(400);
    expect(connectDomain).not.toHaveBeenCalled();
  });

  it("returns the dns instructions from the service", async () => {
    const res = await patchDomain({ domain: "trekkingagency.com" }, "tok");
    const body = await readJson<{ data: typeof CONNECTED }>(res);
    expect(body.data.dnsInstructions?.txt.value).toBe("abc123");
  });
});

/* ── DELETE (disconnect) — paid-tier gated ─────────────────────────────── */

describe("DELETE /agencies/me/domain", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("disconnects the domain", async () => {
    const res = await deleteDomain("tok");
    expect(res.status).toBe(200);
    expect(disconnectDomain).toHaveBeenCalledWith("agency-1");
  });

  it("blocks a FREE-tier agency with 403", async () => {
    paidTierState.blocked = true;

    const res = await deleteDomain("tok");
    expect(res.status).toBe(403);
    expect(disconnectDomain).not.toHaveBeenCalled();
  });
});

/* ── POST verify — paid-tier gated ─────────────────────────────────────── */

describe("POST /agencies/me/domain/verify", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("runs the paid-tier guard", async () => {
    await postVerify("tok");
    expect(paidTierSpy).toHaveBeenCalledTimes(1);
  });

  it("returns verified:false with a detail message when DNS isn't set yet", async () => {
    const res = await postVerify("tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ verified: boolean; message: string }>(res);
    expect(body.verified).toBe(false);
    expect(body.message).toContain("No TXT record");
  });

  it("returns verified:true when the service confirms ownership", async () => {
    verifyDomain.mockResolvedValue({
      settings: { ...CONNECTED, status: "VERIFIED" },
      verified: true,
      detail: "Verified via TXT record.",
    });

    const res = await postVerify("tok");
    const body = await readJson<{ verified: boolean }>(res);
    expect(body.verified).toBe(true);
  });

  it("surfaces a 400 the service throws when no domain is connected", async () => {
    verifyDomain.mockRejectedValue(Object.assign(new Error("Connect a domain before verifying it."), { status: 400 }));

    const res = await postVerify("tok");
    expect(res.status).toBe(400);
  });
});

/* ── POST publish / unpublish — no paid-tier gate ──────────────────────── */

describe("POST /agencies/me/publish and /unpublish", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("publishes without running the paid-tier guard", async () => {
    const res = await postPublish("tok");
    expect(res.status).toBe(200);
    expect(paidTierSpy).not.toHaveBeenCalled();
    expect(publishSite).toHaveBeenCalledWith("agency-1");
  });

  it("still runs the status guard on publish", async () => {
    await postPublish("tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("unpublishes without running the paid-tier guard", async () => {
    const res = await postUnpublish("tok");
    expect(res.status).toBe(200);
    expect(paidTierSpy).not.toHaveBeenCalled();
    expect(unpublishSite).toHaveBeenCalledWith("agency-1");
  });

  it("succeeds even when the agency is on the FREE tier (publish is not a paid feature)", async () => {
    paidTierState.blocked = true;

    const res = await postPublish("tok");
    expect(res.status).toBe(200);
  });
});
