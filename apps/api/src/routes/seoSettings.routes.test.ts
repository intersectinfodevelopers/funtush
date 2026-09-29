import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the SEO-settings routes (backend catch-up pass).
 *
 * Same shape as `siteConfig.routes.test.ts` / `socialLinks.routes.test.ts`.
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

const getSeoSettings = vi.fn();
const getPublicSeoSettingsBySlug = vi.fn();
const updateSeoSettings = vi.fn();

vi.mock("../services/seoSettings.service", () => ({
  getSeoSettings: (...a: unknown[]) => getSeoSettings(...a),
  getPublicSeoSettingsBySlug: (...a: unknown[]) => getPublicSeoSettingsBySlug(...a),
  updateSeoSettings: (...a: unknown[]) => updateSeoSettings(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const SAVED_AT = new Date("2026-08-08T09:00:00.000Z");

const EDITABLE = {
  values: {
    metaTitle: "Himalayan Trails — Guided Treks in Nepal",
    metaDescription: "Small-group treks to Everest Base Camp and beyond, led by local guides.",
    ogImageUrl: null,
  },
  updatedAt: SAVED_AT,
};

const PUBLIC_SETTINGS = { ...EDITABLE.values, updatedAt: SAVED_AT };

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: seoSettingsRoutes } = await import("./seoSettings.routes");

  const app = express();
  app.use(express.json());
  app.use("/", seoSettingsRoutes);

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
  getSeoSettings.mockResolvedValue(EDITABLE);
  updateSeoSettings.mockResolvedValue(EDITABLE);
  getPublicSeoSettingsBySlug.mockResolvedValue(PUBLIC_SETTINGS);
});

function patchJson(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/seo`, {
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
  it("401s the read and the write without a token", async () => {
    expect((await fetch(`${baseUrl}/agencies/me/seo`)).status).toBe(401);
    expect((await patchJson({ metaTitle: "Himalayan Trails" })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchJson({ metaTitle: "Himalayan Trails" });
    expect(updateSeoSettings).not.toHaveBeenCalled();
  });

  it("passes the session's agency id to the service, never a body field", async () => {
    authState.agencyId = "agency-1";

    expect((await patchJson({ metaTitle: "x", agencyId: "other" }, "tok")).status).toBe(400);

    await patchJson({ metaTitle: "Himalayan Trails" }, "tok");
    expect(updateSeoSettings).toHaveBeenCalledWith("agency-1", { metaTitle: "Himalayan Trails" });
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/seo", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid body", async () => {
    const res = await patchJson({ metaTitle: "Himalayan Trails" }, "tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ success: boolean; message: string }>(res);
    expect(body.success).toBe(true);
    expect(body.message).toBe("SEO settings updated");
  });

  it("runs the status guard on the write", async () => {
    await patchJson({ metaTitle: "Himalayan Trails" }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("does not run the status guard on the read", async () => {
    await fetch(`${baseUrl}/agencies/me/seo`, { headers: { "x-refresh-token": "tok" } });
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown key with 400 before the service is called", async () => {
    const res = await patchJson({ title: "Himalayan Trails" }, "tok");

    expect(res.status).toBe(400);
    expect(updateSeoSettings).not.toHaveBeenCalled();
  });

  it("rejects a meta title over 60 characters with 400", async () => {
    const res = await patchJson({ metaTitle: "x".repeat(61) }, "tok");

    expect(res.status).toBe(400);
    expect(updateSeoSettings).not.toHaveBeenCalled();
  });

  it("rejects a meta description over 160 characters with 400", async () => {
    const res = await patchJson({ metaDescription: "x".repeat(161) }, "tok");

    expect(res.status).toBe(400);
    expect(updateSeoSettings).not.toHaveBeenCalled();
  });

  it("rejects text containing < or > with 400", async () => {
    const res = await patchJson({ metaTitle: "<script>alert(1)</script>" }, "tok");

    expect(res.status).toBe(400);
    expect(updateSeoSettings).not.toHaveBeenCalled();
  });

  it("rejects a javascript: image URL with 400", async () => {
    const res = await patchJson({ ogImageUrl: "javascript:alert(1)" }, "tok");

    expect(res.status).toBe(400);
    expect(updateSeoSettings).not.toHaveBeenCalled();
  });

  it("accepts null to clear a field", async () => {
    await patchJson({ metaTitle: null }, "tok");
    expect(updateSeoSettings).toHaveBeenCalledWith("agency-1", { metaTitle: null });
  });

  it("hands the service the trimmed body", async () => {
    await patchJson({ metaTitle: "  Himalayan Trails  " }, "tok");
    expect(updateSeoSettings).toHaveBeenCalledWith("agency-1", { metaTitle: "Himalayan Trails" });
  });

  it("never caches a dashboard response", async () => {
    const res = await patchJson({ metaTitle: "Himalayan Trails" }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── Dashboard reads ────────────────────────────────────────────────────── */

describe("GET /agencies/me/seo", () => {
  it("returns the saved values", async () => {
    authState.agencyId = "agency-1";

    const res = await fetch(`${baseUrl}/agencies/me/seo`, {
      headers: { "x-refresh-token": "tok" },
    });
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof EDITABLE }>(res);
    expect(body.data.values.metaTitle).toBe("Himalayan Trails — Guided Treks in Nepal");
  });
});

/* ── The public read ────────────────────────────────────────────────────── */

describe("GET /site/:slug/seo", () => {
  it("is reachable with no token at all", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/seo`);

    expect(res.status).toBe(200);
    expect(getPublicSeoSettingsBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("lowercases the slug", async () => {
    await fetch(`${baseUrl}/site/Himalayan-Trails/seo`);
    expect(getPublicSeoSettingsBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("labels the response so the regeneration purge can find it", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/seo`);
    expect(res.headers.get("cache-tag")).toBe("seo:himalayan-trails");
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await fetch(`${baseUrl}/site/himalayan-trails/seo`);
    const etag = first.headers.get("etag")!;

    const second = await fetch(`${baseUrl}/site/himalayan-trails/seo`, {
      headers: { "if-none-match": etag },
    });

    expect(second.status).toBe(304);
  });

  it("404s an unknown slug with the service's message", async () => {
    getPublicSeoSettingsBySlug.mockRejectedValue(
      Object.assign(new Error("Site not found"), { status: 404 }),
    );

    const res = await fetch(`${baseUrl}/site/nope/seo`);
    expect(res.status).toBe(404);
  });

  it("does not leak a stack trace on an unexpected failure", async () => {
    getPublicSeoSettingsBySlug.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await fetch(`${baseUrl}/site/himalayan-trails/seo`);
    expect(res.status).toBe(500);

    const body = await readJson<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty("stack");
  });
});
