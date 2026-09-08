import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the navigation builder routes (White-label week · Day 3).
 *
 * Same approach as `siteConfig.routes.test.ts`: a real Express app on a real
 * socket, with auth and the status guard mocked so "who is calling" is driven
 * directly, and the service mocked so these tests are about routing and
 * middleware order, not business logic (that is `navigation.service.test.ts`'s
 * job).
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

const statusGuardSpy = vi.fn();

vi.mock("../middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (_req: unknown, _res: unknown, next: () => void) => {
    statusGuardSpy();
    next();
  },
}));

const getNavigation = vi.fn();
const getNavigationOptions = vi.fn();
const getPublicNavigationBySlug = vi.fn();
const updateNavigation = vi.fn();

vi.mock("../services/navigation.service", () => ({
  getNavigation: (...a: unknown[]) => getNavigation(...a),
  getNavigationOptions: (...a: unknown[]) => getNavigationOptions(...a),
  getPublicNavigationBySlug: (...a: unknown[]) => getPublicNavigationBySlug(...a),
  updateNavigation: (...a: unknown[]) => updateNavigation(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const SAVED_AT = new Date("2026-08-09T09:00:00.000Z");

const EDITABLE = {
  tier: "LARGE",
  items: [{ label: "Destinations", linkType: "INTERNAL", url: "/destinations", children: [] }],
  bookNowLabel: null,
  bookNowHidden: false,
  capabilities: { customNavigation: true, bookNowCustomization: true },
  effectiveNavigation: {
    items: [{ label: "Destinations", linkType: "INTERNAL", url: "/destinations", children: [] }],
    bookNow: { label: "Book Now", hidden: false },
    isCustom: true,
    updatedAt: SAVED_AT,
  },
  updatedAt: SAVED_AT,
};

const PUBLIC_NAVIGATION = {
  items: [{ label: "Home", linkType: "INTERNAL", url: "/", children: [] }],
  bookNow: { label: "Book Now", hidden: false },
  isCustom: false,
  updatedAt: SAVED_AT,
  agencySlug: "himalayan-trails",
};

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: navigationRoutes } = await import("./navigation.routes");

  const app = express();
  app.use(express.json());
  app.use("/", navigationRoutes);

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
  getNavigation.mockResolvedValue(EDITABLE);
  updateNavigation.mockResolvedValue(EDITABLE);
  getNavigationOptions.mockResolvedValue({ tier: "LARGE", linkTypes: [] });
  getPublicNavigationBySlug.mockResolvedValue(PUBLIC_NAVIGATION);
});

function patchJson(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/navigation`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-refresh-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

describe("auth on the dashboard endpoints", () => {
  it("401s every /agencies/me/navigation route without a token", async () => {
    for (const path of ["/agencies/me/navigation", "/agencies/me/navigation/options"]) {
      expect((await fetch(`${baseUrl}${path}`)).status, path).toBe(401);
    }
    expect((await patchJson({ bookNowHidden: true })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchJson({ bookNowHidden: true });
    expect(updateNavigation).not.toHaveBeenCalled();
  });

  it("passes the session's agency id to the service, never a body field", async () => {
    authState.agencyId = "agency-1";

    // `.strict()` rejects `agencyId` in the body outright.
    expect((await patchJson({ bookNowHidden: true, agencyId: "other" }, "tok")).status).toBe(400);

    await patchJson({ bookNowHidden: true }, "tok");
    expect(updateNavigation).toHaveBeenCalledWith("agency-1", { bookNowHidden: true });
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/navigation", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid body", async () => {
    const res = await patchJson(
      { items: [{ label: "Destinations", linkType: "INTERNAL", url: "/destinations" }] },
      "tok",
    );
    expect(res.status).toBe(200);

    const body = await readJson<{ success: boolean; message: string }>(res);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Navigation updated");
  });

  it("runs the status guard before the controller", async () => {
    await patchJson({ bookNowHidden: true }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("does not run the status guard on the reads", async () => {
    await fetch(`${baseUrl}/agencies/me/navigation`, { headers: { "x-refresh-token": "tok" } });
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown top-level key with 400 before the service is called", async () => {
    const res = await patchJson({ item: [] }, "tok");
    expect(res.status).toBe(400);
    expect(updateNavigation).not.toHaveBeenCalled();
  });

  it("rejects a javascript: external link with 400 before the service is called", async () => {
    const res = await patchJson(
      { items: [{ label: "Bad", linkType: "EXTERNAL", url: "javascript:alert(1)" }] },
      "tok",
    );
    expect(res.status).toBe(400);
    expect(updateNavigation).not.toHaveBeenCalled();
  });

  it("rejects a third level of dropdown nesting with 400", async () => {
    const res = await patchJson(
      {
        items: [
          {
            label: "A",
            linkType: "INTERNAL",
            url: "/a",
            children: [{ label: "B", linkType: "INTERNAL", url: "/b", children: [{ label: "C" }] }],
          },
        ],
      },
      "tok",
    );
    expect(res.status).toBe(400);
    expect(updateNavigation).not.toHaveBeenCalled();
  });

  it("hands the service the trimmed, normalised body", async () => {
    await patchJson({ bookNowLabel: "  Reserve Now  " }, "tok");
    expect(updateNavigation).toHaveBeenCalledWith("agency-1", { bookNowLabel: "Reserve Now" });
  });

  it("surfaces a 403 from the tier rules with its message", async () => {
    updateNavigation.mockRejectedValue(
      Object.assign(new Error("Custom navigation menus are available on the Medium and Large plans."), {
        status: 403,
      }),
    );

    const res = await patchJson({ items: [] }, "tok");
    expect(res.status).toBe(403);

    const body = await readJson<{ message: string }>(res);
    expect(body.message).toContain("Medium and Large");
  });

  it("never caches a dashboard response", async () => {
    const res = await patchJson({ bookNowHidden: true }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── Dashboard reads ────────────────────────────────────────────────────── */

describe("GET /agencies/me/navigation", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("returns the stored menu and capabilities", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/navigation`, {
      headers: { "x-refresh-token": "tok" },
    });
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof EDITABLE }>(res);
    expect(body.data.capabilities.customNavigation).toBe(true);
  });

  it("serves the options from a separate path", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/navigation/options`, {
      headers: { "x-refresh-token": "tok" },
    });

    expect(res.status).toBe(200);
    expect(getNavigationOptions).toHaveBeenCalledWith("agency-1");
    expect(getNavigation).not.toHaveBeenCalled();
  });
});

/* ── The public read ────────────────────────────────────────────────────── */

describe("GET /site/:slug/navigation", () => {
  it("is reachable with no token at all", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/navigation`);
    expect(res.status).toBe(200);
    expect(getPublicNavigationBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("lowercases the slug", async () => {
    await fetch(`${baseUrl}/site/Himalayan-Trails/navigation`);
    expect(getPublicNavigationBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("is cacheable for a short, Day-2-matching duration", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/navigation`);
    const cacheControl = res.headers.get("cache-control")!;

    expect(cacheControl).toContain("public");
    const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)![1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(15);
  });

  it("labels the response so Day 4's purge can find it", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/navigation`);

    expect(res.headers.get("cache-tag")).toBe("nav:himalayan-trails");
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await fetch(`${baseUrl}/site/himalayan-trails/navigation`);
    const etag = first.headers.get("etag")!;

    const second = await fetch(`${baseUrl}/site/himalayan-trails/navigation`, {
      headers: { "if-none-match": etag },
    });

    expect(second.status).toBe(304);
  });

  it("gives every never-configured agency the same ETag", async () => {
    getPublicNavigationBySlug.mockResolvedValue({ ...PUBLIC_NAVIGATION, updatedAt: null });
    const res = await fetch(`${baseUrl}/site/himalayan-trails/navigation`);
    expect(res.headers.get("etag")).toContain("init");
  });

  it("404s an unknown slug with the service's message", async () => {
    getPublicNavigationBySlug.mockRejectedValue(Object.assign(new Error("Site not found"), { status: 404 }));

    const res = await fetch(`${baseUrl}/site/nope/navigation`);
    expect(res.status).toBe(404);
  });

  it("does not leak a stack trace on an unexpected failure", async () => {
    getPublicNavigationBySlug.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await fetch(`${baseUrl}/site/himalayan-trails/navigation`);
    expect(res.status).toBe(500);

    const body = await readJson<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty("stack");
  });
});
