import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the site configuration routes (White-label week · Day 2).
 *
 * These go through a real Express app on a real socket, so they cover what the
 * unit tests structurally cannot: that the router is mounted at the paths the
 * task implies, that the guards are attached *and in the right order*, that
 * `validate()` actually runs before the controller, and that the public read is
 * genuinely public.
 *
 * The auth and status middleware are mocked so "who is calling" can be driven
 * directly — importing the real `refreshTokenAuthentication` pulls in
 * `@funtush/database` and tries to reach Postgres on every request.
 */

const { authState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
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

/** Records whether the status guard ran, so its presence can be asserted. */
const statusGuardSpy = vi.fn();

vi.mock("../middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (_req: unknown, _res: unknown, next: () => void) => {
    statusGuardSpy();
    next();
  },
}));

const getSiteConfig = vi.fn();
const getSiteConfigOptions = vi.fn();
const getPublicSiteConfigBySlug = vi.fn();
const updateSiteConfig = vi.fn();

vi.mock("../services/siteConfig.service", () => ({
  getSiteConfig: (...a: unknown[]) => getSiteConfig(...a),
  getSiteConfigOptions: (...a: unknown[]) => getSiteConfigOptions(...a),
  getPublicSiteConfigBySlug: (...a: unknown[]) => getPublicSiteConfigBySlug(...a),
  updateSiteConfig: (...a: unknown[]) => updateSiteConfig(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const SAVED_AT = new Date("2026-08-08T09:00:00.000Z");

const EDITABLE = {
  tier: "MEDIUM",
  values: { underConstruction: false, topBarEnabled: true, topBarText: "15% off" },
  capabilities: { popupModal: true, funtushBadgeToggle: true, topBarColorMode: "free" },
  effectiveFuntushBadge: false,
  updatedAt: SAVED_AT,
};

const PUBLIC_CONFIG = {
  underConstruction: false,
  comingSoon: null,
  topBar: {
    text: "15% off autumn departures",
    behavior: "SCROLLING",
    backgroundColor: "#0F766E",
    textColor: "#FFFFFF",
    linkUrl: null,
    dismissible: true,
  },
  popup: null,
  showFuntushBadge: false,
  updatedAt: SAVED_AT,
  agencySlug: "himalayan-trails",
};

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: siteConfigRoutes } = await import("./siteConfig.routes");

  const app = express();
  app.use(express.json());
  app.use("/", siteConfigRoutes);

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
  getSiteConfig.mockResolvedValue(EDITABLE);
  updateSiteConfig.mockResolvedValue(EDITABLE);
  getSiteConfigOptions.mockResolvedValue({ tier: "MEDIUM", topBarBehaviors: [] });
  getPublicSiteConfigBySlug.mockResolvedValue(PUBLIC_CONFIG);
});

function patchJson(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/site-config`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-refresh-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** `Response.json()` is typed `unknown`; narrow it in one place. */
async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

describe("auth on the dashboard endpoints", () => {
  it("401s every /agencies/me/site-config route without a token", async () => {
    for (const path of ["/agencies/me/site-config", "/agencies/me/site-config/options"]) {
      expect((await fetch(`${baseUrl}${path}`)).status, path).toBe(401);
    }
    expect((await patchJson({ underConstruction: true })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchJson({ underConstruction: true });
    expect(updateSiteConfig).not.toHaveBeenCalled();
  });

  it("passes the session's agency id to the service, never a body field", async () => {
    authState.agencyId = "agency-1";

    // `.strict()` rejects `agencyId` in the body outright — the strongest
    // possible answer to "can a client name someone else's tenant?".
    expect((await patchJson({ underConstruction: true, agencyId: "other" }, "tok")).status).toBe(400);

    await patchJson({ underConstruction: true }, "tok");
    expect(updateSiteConfig).toHaveBeenCalledWith("agency-1", { underConstruction: true });
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/site-config", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid body", async () => {
    const res = await patchJson({ topBarEnabled: true, topBarText: "15% off" }, "tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ success: boolean; message: string }>(res);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Site configuration updated");
  });

  it("runs the status guard before the controller", async () => {
    // A LOCKED agency is read-only (Backend Guide §6) — including, deliberately,
    // being unable to switch construction mode *off*, which would route around
    // the lock.
    await patchJson({ underConstruction: true }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("does not run the status guard on the reads", async () => {
    // A locked agency must still be able to *see* its settings and export its
    // data. Read-only means read-only, not invisible.
    await fetch(`${baseUrl}/agencies/me/site-config`, { headers: { "x-refresh-token": "tok" } });
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown key with 400 before the service is called", async () => {
    const res = await patchJson({ topBarEnable: true }, "tok");

    expect(res.status).toBe(400);
    expect(updateSiteConfig).not.toHaveBeenCalled();
  });

  it("rejects a javascript: link with 400 before the service is called", async () => {
    const res = await patchJson({ popupCtaUrl: "javascript:alert(1)" }, "tok");

    expect(res.status).toBe(400);
    expect(updateSiteConfig).not.toHaveBeenCalled();
  });

  it("hands the service the trimmed, normalised body", async () => {
    // Proof that `validate()` really replaced `req.body` rather than merely
    // inspecting it — the controller must never see the raw input.
    await patchJson({ topBarText: "  15% off  ", topBarBackgroundColor: "#0f766e" }, "tok");

    expect(updateSiteConfig).toHaveBeenCalledWith("agency-1", {
      topBarText: "15% off",
      topBarBackgroundColor: "#0F766E",
    });
  });

  it("surfaces a 403 from the tier rules with its message", async () => {
    updateSiteConfig.mockRejectedValue(
      Object.assign(new Error("Popup modals are available on the Medium and Large plans."), {
        status: 403,
      }),
    );

    const res = await patchJson({ popupEnabled: true }, "tok");
    expect(res.status).toBe(403);

    const body = await readJson<{ message: string }>(res);
    expect(body.message).toContain("Medium and Large");
  });

  it("surfaces a 400 from the coherence rules", async () => {
    updateSiteConfig.mockRejectedValue(
      Object.assign(new Error("Add top bar text before switching the announcement bar on."), {
        status: 400,
      }),
    );

    expect((await patchJson({ topBarEnabled: true }, "tok")).status).toBe(400);
  });

  it("never caches a dashboard response", async () => {
    const res = await patchJson({ underConstruction: true }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── Dashboard reads ────────────────────────────────────────────────────── */

describe("GET /agencies/me/site-config", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("returns values and capabilities", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/site-config`, {
      headers: { "x-refresh-token": "tok" },
    });
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof EDITABLE }>(res);
    expect(body.data.capabilities.popupModal).toBe(true);
  });

  it("serves the options from a separate path", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/site-config/options`, {
      headers: { "x-refresh-token": "tok" },
    });

    expect(res.status).toBe(200);
    expect(getSiteConfigOptions).toHaveBeenCalledWith("agency-1");
    // The options path must not be swallowed by the `/site-config` route above
    // it — Express matches in declaration order and an exact-path route does not
    // match a longer path, but asserting it costs nothing and catches a future
    // switch to a wildcard.
    expect(getSiteConfig).not.toHaveBeenCalled();
  });
});

/* ── The public read ────────────────────────────────────────────────────── */

describe("GET /site/:slug/config", () => {
  it("is reachable with no token at all", async () => {
    // It describes a public website. Requiring a token would mean an anonymous
    // visitor's first paint has no announcement bar.
    const res = await fetch(`${baseUrl}/site/himalayan-trails/config`);

    expect(res.status).toBe(200);
    expect(getPublicSiteConfigBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("lowercases the slug", async () => {
    await fetch(`${baseUrl}/site/Himalayan-Trails/config`);
    expect(getPublicSiteConfigBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("answers 200 — not 503 — while the site is under construction", async () => {
    // This is the endpoint whose whole job is telling the renderer *which page
    // to draw*. A 503 here would mean the renderer could not find out that it
    // should draw the coming-soon page. The 503 lives on the content routes.
    getPublicSiteConfigBySlug.mockResolvedValue({
      ...PUBLIC_CONFIG,
      underConstruction: true,
      comingSoon: { headline: "Back in October", message: "We're rebuilding." },
      topBar: null,
      popup: null,
    });

    const res = await fetch(`${baseUrl}/site/himalayan-trails/config`);
    expect(res.status).toBe(200);

    const body = await readJson<{ data: { underConstruction: boolean } }>(res);
    expect(body.data.underConstruction).toBe(true);
  });

  it("is cacheable, but for far less time than branding", async () => {
    // Branding gets 60s because a logo changes twice a year. This payload holds
    // the switch that takes a website offline.
    const res = await fetch(`${baseUrl}/site/himalayan-trails/config`);
    const cacheControl = res.headers.get("cache-control")!;

    expect(cacheControl).toContain("public");
    const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)![1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(15);
  });

  it("labels the response so Day 4's purge can find it", async () => {
    // 15 seconds is short, but this payload holds the switch that takes a
    // website offline — "your launch is live in up to fifteen seconds" is not a
    // sentence anyone wants to say. The tag is what makes it instant.
    const res = await fetch(`${baseUrl}/site/himalayan-trails/config`);

    expect(res.headers.get("cache-tag")).toBe("config:himalayan-trails");
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await fetch(`${baseUrl}/site/himalayan-trails/config`);
    const etag = first.headers.get("etag")!;

    const second = await fetch(`${baseUrl}/site/himalayan-trails/config`, {
      headers: { "if-none-match": etag },
    });

    expect(second.status).toBe(304);
  });

  it("changes its ETag when the config is saved again", async () => {
    // The tag keys on `updatedAt`, which Prisma bumps on every save. If it did
    // not change, an agency's announcement would not appear until the TTL ran out.
    const first = await fetch(`${baseUrl}/site/himalayan-trails/config`);

    getPublicSiteConfigBySlug.mockResolvedValue({
      ...PUBLIC_CONFIG,
      updatedAt: new Date("2026-08-08T12:00:00.000Z"),
    });
    const second = await fetch(`${baseUrl}/site/himalayan-trails/config`);

    expect(second.headers.get("etag")).not.toBe(first.headers.get("etag"));
  });

  it("gives every never-configured agency the same ETag", async () => {
    // Correct rather than lazy: they all render the identical default site.
    getPublicSiteConfigBySlug.mockResolvedValue({ ...PUBLIC_CONFIG, updatedAt: null });

    const res = await fetch(`${baseUrl}/site/himalayan-trails/config`);
    expect(res.headers.get("etag")).toContain("init");
  });

  it("404s an unknown slug with the service's message", async () => {
    getPublicSiteConfigBySlug.mockRejectedValue(
      Object.assign(new Error("Site not found"), { status: 404 }),
    );

    const res = await fetch(`${baseUrl}/site/nope/config`);
    expect(res.status).toBe(404);
  });

  it("does not leak a stack trace on an unexpected failure", async () => {
    getPublicSiteConfigBySlug.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await fetch(`${baseUrl}/site/himalayan-trails/config`);
    expect(res.status).toBe(500);

    const body = await readJson<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty("stack");
  });
});
