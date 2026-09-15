import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the page-builder routes (backend catch-up pass,
 * Phase 8). Same shape as `navigation.routes.test.ts`/`domain.routes.test.ts`:
 * real Express app on a real socket, only auth/status-guard/site-live-guard/
 * service mocked.
 *
 * `requireSiteLive` is exercised as a togglable spy, same pattern
 * `domain.routes.test.ts` used for `isPaidTier` — this also proves the public
 * read is actually gated by it, unlike every sibling public read in this pass.
 */

const { authState, siteLiveState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
  siteLiveState: { live: true },
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

vi.mock("../middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (_req: unknown, _res: unknown, next: () => void) => {
    statusGuardSpy();
    next();
  },
}));

const siteLiveSpy = vi.fn();

vi.mock("../middleware/siteLive.middleware", () => ({
  requireSiteLive: (
    _req: unknown,
    res: { status: (c: number) => { json: (b: unknown) => void }; setHeader: () => void },
    next: () => void,
  ) => {
    siteLiveSpy();
    if (!siteLiveState.live) {
      return res.status(503).json({ success: false, underConstruction: true, message: "not live" });
    }
    next();
  },
}));

const getSitePage = vi.fn();
const getSitePageOptions = vi.fn();
const updateSitePage = vi.fn();
const applySiteTemplate = vi.fn();
const getPublicSitePageBySlug = vi.fn();

vi.mock("../services/sitePage.service", () => ({
  getSitePage: (...a: unknown[]) => getSitePage(...a),
  getSitePageOptions: (...a: unknown[]) => getSitePageOptions(...a),
  updateSitePage: (...a: unknown[]) => updateSitePage(...a),
  applySiteTemplate: (...a: unknown[]) => applySiteTemplate(...a),
  getPublicSitePageBySlug: (...a: unknown[]) => getPublicSitePageBySlug(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const SAVED_AT = new Date("2026-09-17T09:00:00.000Z");

const HERO_SECTION = {
  id: "sec-1",
  type: "HERO",
  position: 0,
  title: "Adventure Awaits",
  text: null,
  subtitle: "Discover unforgettable treks.",
  image: null,
  link: null,
  ctaText: "Explore Packages",
  ctaText2: null,
  ctaLink2: null,
  heroHeight: "LARGE",
  overlayEnabled: false,
  fontSize: null,
  speed: null,
  direction: null,
  useThemeBg: true,
  bgColor: null,
  useThemeText: true,
  textColor: null,
  spacingTop: null,
  spacingBottom: null,
  itemCount: null,
  selectedIds: [],
  cardWidth: null,
  cardHeight: null,
  adPosition: null,
  widthPercent: 100,
};

const RESOLVED = {
  templateId: "classic-trek-operator",
  variant: "CLASSIC",
  name: null,
  header: { style: "STANDARD", ctaText: "Book Now", ctaLink: "/packages", sticky: true },
  footer: { style: "BASIC" },
  sections: [HERO_SECTION],
  updatedAt: SAVED_AT,
};

const EDITABLE = { ...RESOLVED, tier: "MEDIUM", capabilities: { paidTemplates: true } };

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: sitePageRoutes } = await import("./sitePage.routes");

  const app = express();
  app.use(express.json());
  app.use("/", sitePageRoutes);

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
  siteLiveState.live = true;
  getSitePage.mockResolvedValue(EDITABLE);
  getSitePageOptions.mockResolvedValue({
    tier: "MEDIUM",
    templates: [{ id: "classic-trek-operator", name: "Classic Trek Operator", tier: "FREE", locked: false }],
    sectionTypes: [{ value: "HERO", label: "Hero Banner" }],
    capabilities: { paidTemplates: true },
  });
  updateSitePage.mockResolvedValue({ ...EDITABLE, regeneration: { id: "r1", scopes: ["sitePage"] } });
  applySiteTemplate.mockResolvedValue({ ...EDITABLE, regeneration: { id: "r2", scopes: ["sitePage"] } });
  getPublicSitePageBySlug.mockResolvedValue({ ...RESOLVED, agencySlug: "himalayan-trails" });
});

function authHeaders(token?: string) {
  return token ? { "x-refresh-token": token } : {};
}

function getSite(token?: string) {
  return fetch(`${baseUrl}/agencies/me/site-page`, { headers: authHeaders(token) });
}

function patchSite(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/site-page`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });
}

function postApplyTemplate(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/site-page/apply-template`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

describe("auth on the dashboard endpoints", () => {
  it("401s the read, the options read, the write, and apply-template without a token", async () => {
    expect((await getSite()).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/agencies/me/site-page/options`)).status,
    ).toBe(401);
    expect((await patchSite({ name: "x" })).status).toBe(401);
    expect((await postApplyTemplate({ templateId: "classic-trek-operator" })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchSite({ name: "x" });
    expect(updateSitePage).not.toHaveBeenCalled();
  });
});

/* ── GET ────────────────────────────────────────────────────────────────── */

describe("GET /agencies/me/site-page", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("returns the current page", async () => {
    const res = await getSite("tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof EDITABLE }>(res);
    expect(body.data.sections[0].type).toBe("HERO");
    expect(getSitePage).toHaveBeenCalledWith("agency-1");
  });

  it("does not run the status guard on a read", async () => {
    await getSite("tok");
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("never caches a dashboard response", async () => {
    const res = await getSite("tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── options ────────────────────────────────────────────────────────────── */

describe("GET /agencies/me/site-page/options", () => {
  it("serves the options from a separate path", async () => {
    authState.agencyId = "agency-1";

    const res = await fetch(`${baseUrl}/agencies/me/site-page/options`, {
      headers: { "x-refresh-token": "tok" },
    });

    expect(res.status).toBe(200);
    expect(getSitePageOptions).toHaveBeenCalledWith("agency-1");
    expect(getSitePage).not.toHaveBeenCalled();
  });
});

/* ── PATCH ──────────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/site-page", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid chrome-only body", async () => {
    const res = await patchSite({ headerSticky: false }, "tok");
    expect(res.status).toBe(200);
    expect(updateSitePage).toHaveBeenCalledWith("agency-1", { headerSticky: false });
  });

  it("runs the status guard on the write", async () => {
    await patchSite({ headerSticky: false }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown top-level key with 400 before the service is called", async () => {
    const res = await patchSite({ templateId: "classic-trek-operator" }, "tok");
    expect(res.status).toBe(400);
    expect(updateSitePage).not.toHaveBeenCalled();
  });

  it("rejects an invalid variant with 400", async () => {
    const res = await patchSite({ variant: "NEON" }, "tok");
    expect(res.status).toBe(400);
    expect(updateSitePage).not.toHaveBeenCalled();
  });

  it("accepts a full section list and passes it through untouched", async () => {
    const sections = [{ type: "HERO", title: "Welcome", widthPercent: 100 }];
    await patchSite({ sections }, "tok");
    expect(updateSitePage).toHaveBeenCalledWith("agency-1", { sections });
  });

  it("rejects an unknown section type with 400", async () => {
    const res = await patchSite({ sections: [{ type: "CAROUSEL" }] }, "tok");
    expect(res.status).toBe(400);
    expect(updateSitePage).not.toHaveBeenCalled();
  });

  it("rejects a widthPercent outside the allowed set with 400", async () => {
    const res = await patchSite({ sections: [{ type: "HERO", widthPercent: 60 }] }, "tok");
    expect(res.status).toBe(400);
    expect(updateSitePage).not.toHaveBeenCalled();
  });

  it("rejects a link containing an unsafe scheme with 400", async () => {
    const res = await patchSite({ sections: [{ type: "HERO", link: "javascript:alert(1)" }] }, "tok");
    expect(res.status).toBe(400);
    expect(updateSitePage).not.toHaveBeenCalled();
  });

  it("rejects title text containing < or > with 400", async () => {
    const res = await patchSite({ sections: [{ type: "HERO", title: "<script>" }] }, "tok");
    expect(res.status).toBe(400);
    expect(updateSitePage).not.toHaveBeenCalled();
  });

  it("rejects more than the max number of sections with 400", async () => {
    const sections = Array.from({ length: 41 }, () => ({ type: "TEXTBLOCK" }));
    const res = await patchSite({ sections }, "tok");
    expect(res.status).toBe(400);
    expect(updateSitePage).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 400 (the service's no-op guard)", async () => {
    updateSitePage.mockRejectedValue(Object.assign(new Error("No page fields provided to update"), { status: 400 }));
    const res = await patchSite({}, "tok");
    expect(res.status).toBe(400);
  });

  it("never caches a dashboard response", async () => {
    const res = await patchSite({ headerSticky: false }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns the regeneration receipt alongside the data", async () => {
    const res = await patchSite({ headerSticky: false }, "tok");
    const body = await readJson<{ regeneration: { scopes: string[] } }>(res);
    expect(body.regeneration.scopes).toEqual(["sitePage"]);
  });
});

/* ── apply-template ─────────────────────────────────────────────────────── */

describe("POST /agencies/me/site-page/apply-template", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("applies a known template", async () => {
    const res = await postApplyTemplate({ templateId: "classic-trek-operator" }, "tok");
    expect(res.status).toBe(200);
    expect(applySiteTemplate).toHaveBeenCalledWith("agency-1", "classic-trek-operator");
  });

  it("runs the status guard", async () => {
    await postApplyTemplate({ templateId: "classic-trek-operator" }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown template id with 400 before the service is called", async () => {
    const res = await postApplyTemplate({ templateId: "does-not-exist" }, "tok");
    expect(res.status).toBe(400);
    expect(applySiteTemplate).not.toHaveBeenCalled();
  });

  it("rejects an unknown top-level key with 400", async () => {
    const res = await postApplyTemplate({ templateId: "classic-trek-operator", sections: [] }, "tok");
    expect(res.status).toBe(400);
    expect(applySiteTemplate).not.toHaveBeenCalled();
  });

  it("surfaces a 403 the service throws for a locked template", async () => {
    applySiteTemplate.mockRejectedValue(
      Object.assign(new Error('The "Adventure Landing" template is available on paid plans. Upgrade to use it.'), {
        status: 403,
      }),
    );

    const res = await postApplyTemplate({ templateId: "adventure-landing" }, "tok");
    expect(res.status).toBe(403);
  });
});

/* ── Public read ────────────────────────────────────────────────────────── */

describe("GET /site/:slug/site-page", () => {
  it("returns the resolved page when the site is live", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/site-page`);
    expect(res.status).toBe(200);
    expect(siteLiveSpy).toHaveBeenCalledTimes(1);

    const body = await readJson<{ data: typeof RESOLVED & { agencySlug: string } }>(res);
    expect(body.data.agencySlug).toBe("himalayan-trails");
  });

  it("is gated by requireSiteLive — 503s and never reaches the service when the site isn't live", async () => {
    siteLiveState.live = false;

    const res = await fetch(`${baseUrl}/site/himalayan-trails/site-page`);
    expect(res.status).toBe(503);
    expect(getPublicSitePageBySlug).not.toHaveBeenCalled();
  });

  it("requires no auth token", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/site-page`);
    expect(res.status).not.toBe(401);
  });

  it("sets a short public cache and a Cache-Tag header", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/site-page`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=15, stale-while-revalidate=60");
    expect(res.headers.get("cache-tag")).toBe("page:himalayan-trails");
  });

  it("304s a repeat request carrying the same ETag", async () => {
    const first = await fetch(`${baseUrl}/site/himalayan-trails/site-page`);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await fetch(`${baseUrl}/site/himalayan-trails/site-page`, {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
  });

  it("404s for an agency the service says doesn't exist", async () => {
    getPublicSitePageBySlug.mockRejectedValue(Object.assign(new Error("Site not found"), { status: 404 }));

    const res = await fetch(`${baseUrl}/site/unknown-agency/site-page`);
    expect(res.status).toBe(404);
  });
});
