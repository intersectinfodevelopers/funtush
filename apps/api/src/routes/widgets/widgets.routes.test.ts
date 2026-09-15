import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the widget config routes (API-wide docs/test pass,
 * Batch 3). This is the file whose fix this test suite most cares about:
 * `whatsapp`/`livechat`/`google`/`facebook`/`instagram` used to run with no
 * `authenticateWithRefreshToken` at all — `tierGate` alone doesn't
 * authenticate anyone, it only reads whatever `req.tenantId` the *previous*
 * middleware set, and the only thing setting it here was the
 * Host-header-only `resolveTenant`. Every "401 without a token" assertion
 * below is the regression test for that.
 */

const { authState, tierState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
  tierState: { blocked: false },
}));

vi.mock("src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.agencyId) return res.status(401).json({ message: "Refresh token is required" });
    req.tenantId = authState.agencyId;
    next();
  },
}));

const tierGateSpy = vi.fn();
vi.mock("src/middleware/tierGateCheck.middleware", () => ({
  tierGate:
    (_allowed: string[]) =>
    (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, next: () => void) => {
      tierGateSpy();
      if (tierState.blocked) return res.status(403).json({ success: false, message: "Tier gate" });
      next();
    },
}));

const getWidgetsController = vi.fn((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
  res.status(200).json({ success: true, data: {} }),
);
const whatsappWidgetController = vi.fn((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
  res.status(200).json({ success: true, data: {} }),
);
const livechatWidgetController = vi.fn((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
  res.status(200).json({ success: true, data: {} }),
);
const googleAnalyticsWidgetController = vi.fn(
  (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => res.status(200).json({ success: true, data: {} }),
);
const facebookPixelWidgetController = vi.fn(
  (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => res.status(200).json({ success: true, data: {} }),
);

vi.mock("src/controllers/widgets/widgets.controller", () => ({
  getWidgetsController: (...a: unknown[]) => (getWidgetsController as unknown as (...a: unknown[]) => void)(...a),
  whatsappWidgetController: (...a: unknown[]) => (whatsappWidgetController as unknown as (...a: unknown[]) => void)(...a),
  livechatWidgetController: (...a: unknown[]) => (livechatWidgetController as unknown as (...a: unknown[]) => void)(...a),
  googleAnalyticsWidgetController: (...a: unknown[]) =>
    (googleAnalyticsWidgetController as unknown as (...a: unknown[]) => void)(...a),
  facebookPixelWidgetController: (...a: unknown[]) =>
    (facebookPixelWidgetController as unknown as (...a: unknown[]) => void)(...a),
}));

const InstagramWidgetController = vi.fn((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
  res.status(200).json({ success: true, data: {} }),
);
vi.mock("src/controllers/widgets/instagram.controller", () => ({
  InstagramWidgetController: (...a: unknown[]) => (InstagramWidgetController as unknown as (...a: unknown[]) => void)(...a),
}));

vi.mock("src/controllers/widgets/youtube.controller", () => ({
  updateYoutubeWidgetController: (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
    res.status(200).json({ success: true }),
}));
vi.mock("src/controllers/widgets/weather.controller", () => ({
  weatherWidgetController: (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
    res.status(200).json({ success: true }),
  weatherRequestController: (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
    res.status(200).json({ success: true }),
}));
vi.mock("src/controllers/widgets/currencyConverter.controller", () => ({
  currencyConverterWidgetController: (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
    res.status(200).json({ success: true }),
  convertCurrencyController: (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) =>
    res.status(200).json({ success: true }),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: widgetsRoutes } = await import("./widgets.routes");

  const app = express();
  app.use(express.json());
  app.use("/", widgetsRoutes);

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
  tierState.blocked = false;
});

function authed() {
  return { "x-refresh-token": "tok" };
}

describe("401s without a token — the fix under test", () => {
  it.each([
    ["/whatsapp", whatsappWidgetController],
    ["/livechat", livechatWidgetController],
    ["/google", googleAnalyticsWidgetController],
    ["/facebook", facebookPixelWidgetController],
    ["/instagram", InstagramWidgetController],
  ])("PATCH %s is unreachable without a refresh token", async (path, controller) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(controller).not.toHaveBeenCalled();
  });

  it("GET / is unreachable without a refresh token", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(401);
  });
});

describe("authenticated calls reach the controller (auth runs before tierGate)", () => {
  beforeEach(() => {
    authState.agencyId = "agencyuser-1";
  });

  it("PATCH /whatsapp (no tier gate) succeeds for any authenticated agency", async () => {
    const res = await fetch(`${baseUrl}/whatsapp`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ number: "+9779800000000" }),
    });
    expect(res.status).toBe(200);
    expect(whatsappWidgetController).toHaveBeenCalledTimes(1);
  });

  it("PATCH /google runs auth then the tier gate, in that order", async () => {
    await fetch(`${baseUrl}/google`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ trackingId: "G-XXXX" }),
    });
    expect(tierGateSpy).toHaveBeenCalledTimes(1);
    expect(googleAnalyticsWidgetController).toHaveBeenCalledTimes(1);
  });

  it("PATCH /instagram blocked by the tier gate never reaches the controller", async () => {
    tierState.blocked = true;
    const res = await fetch(`${baseUrl}/instagram`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ instagramFeedEnabled: true }),
    });
    expect(res.status).toBe(403);
    expect(InstagramWidgetController).not.toHaveBeenCalled();
  });

  it("GET / returns the widget config", async () => {
    const res = await fetch(`${baseUrl}/`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(getWidgetsController).toHaveBeenCalledTimes(1);
  });
});
