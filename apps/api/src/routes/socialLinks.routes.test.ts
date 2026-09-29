import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the social-links routes (backend catch-up pass).
 *
 * Same shape as `siteConfig.routes.test.ts`: a real Express app on a real
 * socket, only the two guard middlewares and the service mocked, so what's
 * covered is the wiring — mount paths, guard order, `validate()` actually
 * running before the controller, and the public read being genuinely public.
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

const getSocialLinks = vi.fn();
const getPublicSocialLinksBySlug = vi.fn();
const updateSocialLinks = vi.fn();

vi.mock("../services/socialLinks.service", () => ({
  getSocialLinks: (...a: unknown[]) => getSocialLinks(...a),
  getPublicSocialLinksBySlug: (...a: unknown[]) => getPublicSocialLinksBySlug(...a),
  updateSocialLinks: (...a: unknown[]) => updateSocialLinks(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const SAVED_AT = new Date("2026-08-08T09:00:00.000Z");

const EDITABLE = {
  values: {
    facebookUrl: "https://facebook.com/himalayan-trails",
    instagramUrl: null,
    tiktokUrl: null,
    whatsappNumber: "9779841234567",
    youtubeUrl: null,
  },
  updatedAt: SAVED_AT,
};

const PUBLIC_LINKS = {
  ...EDITABLE.values,
  whatsappLink: "https://wa.me/9779841234567",
  updatedAt: SAVED_AT,
};

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: socialLinksRoutes } = await import("./socialLinks.routes");

  const app = express();
  app.use(express.json());
  app.use("/", socialLinksRoutes);

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
  getSocialLinks.mockResolvedValue(EDITABLE);
  updateSocialLinks.mockResolvedValue(EDITABLE);
  getPublicSocialLinksBySlug.mockResolvedValue(PUBLIC_LINKS);
});

function patchJson(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/social-links`, {
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
    expect((await fetch(`${baseUrl}/agencies/me/social-links`)).status).toBe(401);
    expect((await patchJson({ facebookUrl: "https://facebook.com/x" })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchJson({ facebookUrl: "https://facebook.com/x" });
    expect(updateSocialLinks).not.toHaveBeenCalled();
  });

  it("passes the session's agency id to the service, never a body field", async () => {
    authState.agencyId = "agency-1";

    // `.strict()` rejects `agencyId` in the body outright.
    expect(
      (await patchJson({ facebookUrl: "https://facebook.com/x", agencyId: "other" }, "tok")).status,
    ).toBe(400);

    await patchJson({ facebookUrl: "https://facebook.com/x" }, "tok");
    expect(updateSocialLinks).toHaveBeenCalledWith("agency-1", { facebookUrl: "https://facebook.com/x" });
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/social-links", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid body", async () => {
    const res = await patchJson({ facebookUrl: "https://facebook.com/x" }, "tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ success: boolean; message: string }>(res);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Social links updated");
  });

  it("runs the status guard on the write", async () => {
    await patchJson({ facebookUrl: "https://facebook.com/x" }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("does not run the status guard on the read", async () => {
    await fetch(`${baseUrl}/agencies/me/social-links`, { headers: { "x-refresh-token": "tok" } });
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown key with 400 before the service is called", async () => {
    const res = await patchJson({ facebok: "https://facebook.com/x" }, "tok");

    expect(res.status).toBe(400);
    expect(updateSocialLinks).not.toHaveBeenCalled();
  });

  it("rejects a javascript: URL with 400 before the service is called", async () => {
    const res = await patchJson({ facebookUrl: "javascript:alert(1)" }, "tok");

    expect(res.status).toBe(400);
    expect(updateSocialLinks).not.toHaveBeenCalled();
  });

  it("rejects a malformed WhatsApp number with 400", async () => {
    const res = await patchJson({ whatsappNumber: "not a number" }, "tok");
    expect(res.status).toBe(400);
    expect(updateSocialLinks).not.toHaveBeenCalled();
  });

  it("accepts null to clear a link", async () => {
    await patchJson({ facebookUrl: null }, "tok");
    expect(updateSocialLinks).toHaveBeenCalledWith("agency-1", { facebookUrl: null });
  });

  it("hands the service the trimmed body", async () => {
    await patchJson({ facebookUrl: "  https://facebook.com/x  " }, "tok");
    expect(updateSocialLinks).toHaveBeenCalledWith("agency-1", { facebookUrl: "https://facebook.com/x" });
  });

  it("surfaces a 400 the service throws", async () => {
    updateSocialLinks.mockRejectedValue(
      Object.assign(new Error("No social link fields provided to update"), { status: 400 }),
    );

    expect((await patchJson({ facebookUrl: "https://facebook.com/x" }, "tok")).status).toBe(400);
  });

  it("never caches a dashboard response", async () => {
    const res = await patchJson({ facebookUrl: "https://facebook.com/x" }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── Dashboard reads ────────────────────────────────────────────────────── */

describe("GET /agencies/me/social-links", () => {
  it("returns the saved values", async () => {
    authState.agencyId = "agency-1";

    const res = await fetch(`${baseUrl}/agencies/me/social-links`, {
      headers: { "x-refresh-token": "tok" },
    });
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof EDITABLE }>(res);
    expect(body.data.values.facebookUrl).toBe("https://facebook.com/himalayan-trails");
  });
});

/* ── The public read ────────────────────────────────────────────────────── */

describe("GET /site/:slug/social-links", () => {
  it("is reachable with no token at all", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/social-links`);

    expect(res.status).toBe(200);
    expect(getPublicSocialLinksBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("lowercases the slug", async () => {
    await fetch(`${baseUrl}/site/Himalayan-Trails/social-links`);
    expect(getPublicSocialLinksBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("includes a ready-to-use WhatsApp link", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/social-links`);
    const body = await readJson<{ data: { whatsappLink: string | null } }>(res);

    expect(body.data.whatsappLink).toBe("https://wa.me/9779841234567");
  });

  it("labels the response so the regeneration purge can find it", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/social-links`);
    expect(res.headers.get("cache-tag")).toBe("social:himalayan-trails");
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await fetch(`${baseUrl}/site/himalayan-trails/social-links`);
    const etag = first.headers.get("etag")!;

    const second = await fetch(`${baseUrl}/site/himalayan-trails/social-links`, {
      headers: { "if-none-match": etag },
    });

    expect(second.status).toBe(304);
  });

  it("404s an unknown slug with the service's message", async () => {
    getPublicSocialLinksBySlug.mockRejectedValue(
      Object.assign(new Error("Site not found"), { status: 404 }),
    );

    const res = await fetch(`${baseUrl}/site/nope/social-links`);
    expect(res.status).toBe(404);
  });

  it("does not leak a stack trace on an unexpected failure", async () => {
    getPublicSocialLinksBySlug.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await fetch(`${baseUrl}/site/himalayan-trails/social-links`);
    expect(res.status).toBe(500);

    const body = await readJson<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty("stack");
  });
});
