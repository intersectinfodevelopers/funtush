import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Instagram OAuth `state` handling. `state` used to be the raw agencyId and the
 * callback trusted it as the agency to attach the connection to, so anyone who
 * knew an agency's id could plant their own Instagram account on that agency's
 * site. These tests pin the fix: `state` is random, one-time, and resolved to an
 * agency from the server's own record of who started the flow.
 */

const store = new Map<string, string>();
vi.mock("../../lib/redis", () => ({
  redis: {
    set: async (k: string, v: string) => void store.set(k, v),
    getdel: async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    },
  },
}));

const saveInstagramConnectionService = vi.fn();
vi.mock("src/services/widgets/instagram.service", () => ({
  instagramWidgetService: vi.fn(),
  saveInstagramConnectionService: (...a: unknown[]) => saveInstagramConnectionService(...a),
}));

vi.mock("axios", () => ({
  default: {
    post: vi.fn(async () => ({ data: { access_token: "short", user_id: "ig-1" } })),
    get: vi.fn(async () => ({ data: { access_token: "long", expires_in: 5184000 } })),
  },
}));

import { connectInstagramController, instagramCallbackController } from "./instagram.controller";

function fakeRes() {
  const res: { statusCode: number; body?: unknown; redirectedTo?: string; status: (c: number) => typeof res; json: (b: unknown) => typeof res; redirect: (u: string) => void } = {
    statusCode: 200,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
    redirect(u) { res.redirectedTo = u; },
  };
  return res;
}

async function startFlow(agencyId: string) {
  process.env.INSTAGRAM_REDIRECT_URI = "https://api.example.com/cb";
  const res = fakeRes();
  await connectInstagramController({ agencyId } as never, res as never);
  const state = new URL(res.redirectedTo!).searchParams.get("state")!;
  return { state, url: res.redirectedTo! };
}

async function callback(query: Record<string, unknown>) {
  const res = fakeRes();
  await instagramCallbackController({ query } as never, res as never);
  return res;
}

beforeEach(() => {
  store.clear();
  saveInstagramConnectionService.mockReset();
  saveInstagramConnectionService.mockResolvedValue(undefined);
});

describe("Instagram OAuth state", () => {
  it("uses a random state, never the agency id", async () => {
    const { state, url } = await startFlow("agency-victim");
    expect(state).toMatch(/^[a-f0-9]{48}$/);
    expect(url).not.toContain("agency-victim");
  });

  it("rejects a callback whose state is a raw agency id (the original attack)", async () => {
    const res = await callback({ code: "attackers-own-code", state: "agency-victim" });
    expect(res.statusCode).toBe(400);
    expect(saveInstagramConnectionService).not.toHaveBeenCalled();
  });

  it("rejects a well-formed but never-issued state", async () => {
    const res = await callback({ code: "c", state: "a".repeat(48) });
    expect(res.statusCode).toBe(400);
    expect(saveInstagramConnectionService).not.toHaveBeenCalled();
  });

  it("rejects non-string state/code (query-parser operator injection)", async () => {
    expect((await callback({ code: "c", state: { $ne: "x" } })).statusCode).toBe(400);
    expect((await callback({ code: ["c"], state: "a".repeat(48) })).statusCode).toBe(400);
  });

  it("attaches the connection to the agency that STARTED the flow", async () => {
    const { state } = await startFlow("agency-A");
    const res = await callback({ code: "good", state });
    expect(res.statusCode).toBe(200);
    expect(saveInstagramConnectionService).toHaveBeenCalledTimes(1);
    expect(saveInstagramConnectionService.mock.calls[0][0]).toBe("agency-A");
  });

  it("a state can be used only once (no replay)", async () => {
    const { state } = await startFlow("agency-A");
    expect((await callback({ code: "good", state })).statusCode).toBe(200);
    expect((await callback({ code: "good", state })).statusCode).toBe(400);
    expect(saveInstagramConnectionService).toHaveBeenCalledTimes(1);
  });
});
