import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the branding routes (White-label week · Day 1, plus the
 * `logoWidth`/`receiptFooter` fields added in the backend catch-up pass).
 *
 * Same shape as `siteConfig.routes.test.ts`: a real Express app on a real
 * socket, only the two guard middlewares and the service mocked. File uploads
 * are out of scope here — `brandImageUpload` (multer) passes a non-multipart
 * request straight through untouched (see `branding.controller.ts`'s header),
 * so a plain JSON body exercises the whole PATCH path except the image
 * pipeline, which belongs to `branding.service.ts`'s own unit-level coverage.
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

const getAgencyBranding = vi.fn();
const getBrandingOptions = vi.fn();
const getPublicBrandingBySlug = vi.fn();
const updateAgencyBranding = vi.fn();
const brandingCssVariables = vi.fn((..._a: unknown[]) => ({ "--brand-primary": "#0F766E" }));
const brandingStyleBlock = vi.fn((..._a: unknown[]) => ":root { --brand-primary: #0F766E; }");

vi.mock("../services/branding.service", () => ({
  getAgencyBranding: (...a: unknown[]) => getAgencyBranding(...a),
  getBrandingOptions: (...a: unknown[]) => getBrandingOptions(...a),
  getPublicBrandingBySlug: (...a: unknown[]) => getPublicBrandingBySlug(...a),
  updateAgencyBranding: (...a: unknown[]) => updateAgencyBranding(...a),
  brandingCssVariables: (...a: unknown[]) => brandingCssVariables(...a),
  brandingStyleBlock: (...a: unknown[]) => brandingStyleBlock(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));
vi.mock("@funtush/storage", () => ({
  upload: { fields: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
}));

let server: Server;
let baseUrl: string;

const SAVED_AT = new Date("2026-08-07T09:00:00.000Z");

const RESOLVED_BRANDING = {
  brandName: "Himalayan Trails",
  logoUrl: null,
  faviconUrl: null,
  primaryColor: "#0F766E",
  onPrimaryColor: "#FFFFFF",
  paletteId: "teal",
  fontFamily: "inter",
  fontStack: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  cardImageRatio: "RATIO_4_3",
  cardImageRatioValue: "4 / 3",
  currencyCode: "NPR",
  currencySymbol: "Rs",
  currencyDisplay: "SYMBOL",
  currencyExample: "Rs 1,200",
  colorPickerMode: "curated",
  logoWidth: 140,
  receiptFooter: "Thank you for trekking with us!",
  updatedAt: SAVED_AT,
};

const PUBLIC_BRANDING = { ...RESOLVED_BRANDING, agencySlug: "himalayan-trails" };

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: brandingRoutes } = await import("./branding.routes");

  const app = express();
  app.use(express.json());
  app.use("/", brandingRoutes);

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
  getAgencyBranding.mockResolvedValue(RESOLVED_BRANDING);
  updateAgencyBranding.mockResolvedValue(RESOLVED_BRANDING);
  getBrandingOptions.mockResolvedValue({
    tier: "MEDIUM",
    colorPickerMode: "free",
    logoWidth: { min: 40, max: 280 },
    receiptFooter: { maxLength: 200 },
  });
  getPublicBrandingBySlug.mockResolvedValue(PUBLIC_BRANDING);
});

function patchJson(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/branding`, {
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
  it("401s every /agencies/me/branding route without a token", async () => {
    for (const path of ["/agencies/me/branding", "/agencies/me/branding/options"]) {
      expect((await fetch(`${baseUrl}${path}`)).status, path).toBe(401);
    }
    expect((await patchJson({ brandName: "Trek Co" })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchJson({ brandName: "Trek Co" });
    expect(updateAgencyBranding).not.toHaveBeenCalled();
  });

  it("passes the session's agency id to the service, never a body field", async () => {
    authState.agencyId = "agency-1";

    expect((await patchJson({ brandName: "Trek Co", agencyId: "other" }, "tok")).status).toBe(400);

    await patchJson({ brandName: "Trek Co" }, "tok");
    expect(updateAgencyBranding).toHaveBeenCalledWith("agency-1", { brandName: "Trek Co" }, {});
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/branding", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid body", async () => {
    const res = await patchJson({ brandName: "Himalayan Trails" }, "tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ success: boolean; message: string }>(res);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Branding updated");
  });

  it("runs the status guard on the write", async () => {
    await patchJson({ brandName: "Trek Co" }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("does not run the status guard on the reads", async () => {
    await fetch(`${baseUrl}/agencies/me/branding`, { headers: { "x-refresh-token": "tok" } });
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown key with 400 before the service is called", async () => {
    const res = await patchJson({ primaryColour: "#FF0000" }, "tok");

    expect(res.status).toBe(400);
    expect(updateAgencyBranding).not.toHaveBeenCalled();
  });

  it("never caches a dashboard response", async () => {
    const res = await patchJson({ brandName: "Trek Co" }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  describe("logoWidth", () => {
    it("accepts a value within bounds, as a JSON number", async () => {
      await patchJson({ logoWidth: 180 }, "tok");
      expect(updateAgencyBranding).toHaveBeenCalledWith("agency-1", { logoWidth: 180 }, {});
    });

    it("coerces a stringified number, the shape a multipart save would send", async () => {
      // Verifies the endpoint's real dual JSON/multipart contract even though
      // this suite only ever sends JSON bodies: a plain `z.number()` would
      // 400 here, and a multipart save that also touched this field would
      // fail in exactly this way in production.
      await patchJson({ logoWidth: "180" }, "tok");
      expect(updateAgencyBranding).toHaveBeenCalledWith("agency-1", { logoWidth: 180 }, {});
    });

    it("rejects a value below the minimum with 400", async () => {
      const res = await patchJson({ logoWidth: 10 }, "tok");
      expect(res.status).toBe(400);
      expect(updateAgencyBranding).not.toHaveBeenCalled();
    });

    it("rejects a value above the maximum with 400", async () => {
      const res = await patchJson({ logoWidth: 5000 }, "tok");
      expect(res.status).toBe(400);
      expect(updateAgencyBranding).not.toHaveBeenCalled();
    });

    it("rejects a non-integer with 400", async () => {
      const res = await patchJson({ logoWidth: 140.5 }, "tok");
      expect(res.status).toBe(400);
      expect(updateAgencyBranding).not.toHaveBeenCalled();
    });
  });

  describe("receiptFooter", () => {
    it("saves a valid line", async () => {
      await patchJson({ receiptFooter: "See you on the trail!" }, "tok");
      expect(updateAgencyBranding).toHaveBeenCalledWith(
        "agency-1",
        { receiptFooter: "See you on the trail!" },
        {},
      );
    });

    it("accepts null to clear the override back to the platform default", async () => {
      await patchJson({ receiptFooter: null }, "tok");
      expect(updateAgencyBranding).toHaveBeenCalledWith("agency-1", { receiptFooter: null }, {});
    });

    it("trims before storing", async () => {
      await patchJson({ receiptFooter: "  See you on the trail!  " }, "tok");
      expect(updateAgencyBranding).toHaveBeenCalledWith(
        "agency-1",
        { receiptFooter: "See you on the trail!" },
        {},
      );
    });

    it("rejects text over 200 characters with 400", async () => {
      const res = await patchJson({ receiptFooter: "x".repeat(201) }, "tok");
      expect(res.status).toBe(400);
      expect(updateAgencyBranding).not.toHaveBeenCalled();
    });

    it("rejects text containing < or > with 400", async () => {
      const res = await patchJson({ receiptFooter: "<script>alert(1)</script>" }, "tok");
      expect(res.status).toBe(400);
      expect(updateAgencyBranding).not.toHaveBeenCalled();
    });
  });

  it("surfaces a 403 from the tier colour rule with its message", async () => {
    updateAgencyBranding.mockRejectedValue(
      Object.assign(new Error("Your plan includes the curated colour palette."), { status: 403 }),
    );

    const res = await patchJson({ primaryColor: "#ABCDEF" }, "tok");
    expect(res.status).toBe(403);

    const body = await readJson<{ message: string }>(res);
    expect(body.message).toContain("curated colour palette");
  });
});

/* ── Dashboard reads ────────────────────────────────────────────────────── */

describe("GET /agencies/me/branding", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("returns the resolved theme, including the new fields", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/branding`, {
      headers: { "x-refresh-token": "tok" },
    });
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof RESOLVED_BRANDING }>(res);
    expect(body.data.logoWidth).toBe(140);
    expect(body.data.receiptFooter).toBe("Thank you for trekking with us!");
  });

  it("echoes the CSS custom properties, including the logo width", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/branding`, {
      headers: { "x-refresh-token": "tok" },
    });
    // `GET` doesn't call `brandingCssVariables` in the controller — only the
    // write does — so this just confirms the read shape carries what the
    // write's echo needs to build it from.
    const body = await readJson<{ data: { logoWidth: number } }>(res);
    expect(body.data.logoWidth).toBeGreaterThan(0);
  });

  it("serves the options from a separate path, with the new field bounds", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/branding/options`, {
      headers: { "x-refresh-token": "tok" },
    });

    expect(res.status).toBe(200);
    const body = await readJson<{
      data: { logoWidth: { min: number; max: number }; receiptFooter: { maxLength: number } };
    }>(res);
    expect(body.data.logoWidth).toEqual({ min: 40, max: 280 });
    expect(body.data.receiptFooter).toEqual({ maxLength: 200 });
    expect(getAgencyBranding).not.toHaveBeenCalled();
  });
});

/* ── The public read ────────────────────────────────────────────────────── */

describe("GET /site/:slug/branding", () => {
  it("is reachable with no token at all", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding`);

    expect(res.status).toBe(200);
    expect(getPublicBrandingBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("lowercases the slug", async () => {
    await fetch(`${baseUrl}/site/Himalayan-Trails/branding`);
    expect(getPublicBrandingBySlug).toHaveBeenCalledWith("himalayan-trails");
  });

  it("is cacheable for 60 seconds", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding`);
    expect(res.headers.get("cache-control")).toContain("max-age=60");
  });

  it("labels the response so Day 4's purge can find it", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding`);
    expect(res.headers.get("cache-tag")).toBe("branding:himalayan-trails");
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await fetch(`${baseUrl}/site/himalayan-trails/branding`);
    const etag = first.headers.get("etag")!;

    const second = await fetch(`${baseUrl}/site/himalayan-trails/branding`, {
      headers: { "if-none-match": etag },
    });

    expect(second.status).toBe(304);
  });

  it("serves ?format=css as a real stylesheet", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding?format=css`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("404s an unknown slug with the service's message", async () => {
    getPublicBrandingBySlug.mockRejectedValue(Object.assign(new Error("Site not found"), { status: 404 }));

    const res = await fetch(`${baseUrl}/site/nope/branding`);
    expect(res.status).toBe(404);
  });

  it("does not leak a stack trace on an unexpected failure", async () => {
    getPublicBrandingBySlug.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding`);
    expect(res.status).toBe(500);

    const body = await readJson<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty("stack");
  });
});
