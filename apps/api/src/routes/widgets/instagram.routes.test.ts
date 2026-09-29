import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the Instagram OAuth routes (API-wide docs/test pass,
 * Batch 0). Proves the routing/guard-order this pass wired up — the
 * controller logic itself (token exchange, persistence) is out of scope
 * here and mocked, same as every other route test in this codebase.
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
    req.agencyId = authState.agencyId;
    next();
  },
}));

const tierGateSpy = vi.fn();

vi.mock("src/middleware/tierGateCheck.middleware", () => ({
  tierGate:
    (_allowed: string[]) =>
    (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, next: () => void) => {
      tierGateSpy();
      if (tierState.blocked) {
        return res.status(403).json({ success: false, message: "This feature is available only for LARGE plans." });
      }
      next();
    },
}));

const connectInstagramController = vi.fn((_req: unknown, res: { redirect: (u: string) => void }) => {
  res.redirect("https://www.instagram.com/oauth/authorize?mock=1");
});
const instagramCallbackController = vi.fn(
  (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
    res.status(200).json({ success: true, message: "Instagram connected successfully." });
  },
);

vi.mock("src/controllers/widgets/instagram.controller", () => ({
  connectInstagramController: (...a: unknown[]) =>
    (connectInstagramController as unknown as (...a: unknown[]) => void)(...a),
  instagramCallbackController: (...a: unknown[]) =>
    (instagramCallbackController as unknown as (...a: unknown[]) => void)(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: instagramRoutes } = await import("./instagram.routes");

  const app = express();
  app.use(express.json());
  app.use("/", instagramRoutes);

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

function authHeaders(token?: string) {
  return token ? { "x-refresh-token": token } : {};
}

describe("GET /auth/instagram/connect", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("401s without a token", async () => {
    authState.agencyId = undefined;
    const res = await fetch(`${baseUrl}/auth/instagram/connect`, { redirect: "manual" });
    expect(res.status).toBe(401);
    expect(connectInstagramController).not.toHaveBeenCalled();
  });

  it("runs the tier gate after auth", async () => {
    await fetch(`${baseUrl}/auth/instagram/connect`, { headers: authHeaders("tok"), redirect: "manual" });
    expect(tierGateSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks a non-LARGE tier with 403 before the controller runs", async () => {
    tierState.blocked = true;
    const res = await fetch(`${baseUrl}/auth/instagram/connect`, { headers: authHeaders("tok"), redirect: "manual" });
    expect(res.status).toBe(403);
    expect(connectInstagramController).not.toHaveBeenCalled();
  });

  it("reaches the controller for an authenticated, allowed tier", async () => {
    const res = await fetch(`${baseUrl}/auth/instagram/connect`, { headers: authHeaders("tok"), redirect: "manual" });
    expect(res.status).toBe(302);
    expect(connectInstagramController).toHaveBeenCalledTimes(1);
  });
});

describe("GET /auth/instagram (alias of /connect)", () => {
  it("401s without a token", async () => {
    const res = await fetch(`${baseUrl}/auth/instagram`, { redirect: "manual" });
    expect(res.status).toBe(401);
  });

  it("reaches the same connect controller", async () => {
    authState.agencyId = "agency-1";
    const res = await fetch(`${baseUrl}/auth/instagram`, { headers: authHeaders("tok"), redirect: "manual" });
    expect(res.status).toBe(302);
    expect(connectInstagramController).toHaveBeenCalledTimes(1);
  });
});

describe("GET /auth/instagram/oauth-callback", () => {
  it("requires no auth token — Instagram itself calls this URL", async () => {
    const res = await fetch(`${baseUrl}/auth/instagram/oauth-callback?code=abc123&state=agency-1`);
    expect(res.status).not.toBe(401);
    expect(instagramCallbackController).toHaveBeenCalledTimes(1);
  });

  it("does not run the tier gate", async () => {
    await fetch(`${baseUrl}/auth/instagram/oauth-callback?code=abc123&state=agency-1`);
    expect(tierGateSpy).not.toHaveBeenCalled();
  });
});
