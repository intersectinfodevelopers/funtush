import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the regeneration routes (White-label week · Day 4).
 *
 * Same approach as Day 1–3's route suites: a real Express app with the auth and
 * status middleware mocked, so the "who is calling" dimension can be driven
 * directly without a database.
 *
 * What these cover that the unit tests cannot: that the router is mounted where
 * the day's namespace says it is, that the guards are attached to the right
 * verbs (and, importantly, *not* to the wrong ones), and that the republish
 * button answers 202 rather than pretending the work is finished.
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

const getAgencyBrandContext = vi.fn();

vi.mock("../services/branding.service", () => ({
  getAgencyBrandContext: (...a: unknown[]) => getAgencyBrandContext(...a),
}));

const getRegenerationHistory = vi.fn();
const getRegenerationCapabilities = vi.fn();
const queueRegeneration = vi.fn();

vi.mock("../services/regeneration.service", async (importOriginal) => {
  // The constants stay real so the controller's clamp is tested against the
  // limit that actually ships.
  const actual = await importOriginal<typeof import("../services/regeneration.service")>();
  return {
    ...actual,
    getRegenerationHistory: (...a: unknown[]) => getRegenerationHistory(...a),
    getRegenerationCapabilities: (...a: unknown[]) => getRegenerationCapabilities(...a),
    queueRegeneration: (...a: unknown[]) => queueRegeneration(...a),
  };
});

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const AGENCY_ID = "agency-1";

const RECEIPT = {
  id: "receipt-1",
  agencyId: AGENCY_ID,
  slug: "himalayan-trails",
  scopes: ["branding"],
  status: "running",
  attempts: 1,
};

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: regenerationRoutes } = await import("./regeneration.routes");

  const app = express();
  app.use(express.json());
  app.use("/", regenerationRoutes);

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
  getAgencyBrandContext.mockResolvedValue({
    id: AGENCY_ID,
    name: "Himalayan Trails",
    slug: "himalayan-trails",
    status: "ACTIVE",
    customDomain: "everest-treks.com",
    tier: "MEDIUM",
  });
  getRegenerationHistory.mockReturnValue([RECEIPT]);
  getRegenerationCapabilities.mockReturnValue({ rendererConfigured: true, cdnConfigured: true });
  queueRegeneration.mockReturnValue({ ...RECEIPT, id: "receipt-2" });
});

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const PATH = "/agencies/me/site/regeneration";

/* ── Auth ───────────────────────────────────────────────────────────────── */

describe("auth", () => {
  it("401s both verbs with no token", async () => {
    expect((await fetch(`${baseUrl}${PATH}`)).status).toBe(401);
    expect((await fetch(`${baseUrl}${PATH}`, { method: "POST" })).status).toBe(401);
  });

  it("does not run the status guard on the read", async () => {
    // A LOCKED agency is read-only (Backend Guide §6) but must still be able to
    // ask why its site looks wrong — it is the account most likely to be asking.
    authState.agencyId = AGENCY_ID;
    await fetch(`${baseUrl}${PATH}`);

    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("runs the status guard on the republish", async () => {
    // Republishing a site that is not being served is work with no effect.
    authState.agencyId = AGENCY_ID;
    await fetch(`${baseUrl}${PATH}`, { method: "POST" });

    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });
});

/* ── The read ───────────────────────────────────────────────────────────── */

describe(`GET ${PATH}`, () => {
  beforeEach(() => {
    authState.agencyId = AGENCY_ID;
  });

  it("returns the history and whether the platform is wired up", async () => {
    const res = await fetch(`${baseUrl}${PATH}`);
    const body = await readJson<{
      data: { capabilities: Record<string, boolean>; history: unknown[] };
    }>(res);

    expect(res.status).toBe(200);
    expect(body.data.history).toHaveLength(1);
    // The first question in every "my site didn't update" ticket, answered
    // without SSH access to read an environment variable.
    expect(body.data.capabilities).toEqual({ rendererConfigured: true, cdnConfigured: true });
  });

  it("is never cached — a status screen showing a stale status is worthless", async () => {
    const res = await fetch(`${baseUrl}${PATH}`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reads only the calling agency's history", async () => {
    await fetch(`${baseUrl}${PATH}`);

    // The agency id comes from the session, never from the request (§4). There
    // is no parameter here that could name another tenant.
    expect(getRegenerationHistory.mock.calls[0]![0]).toBe(AGENCY_ID);
  });

  it("clamps an absurd ?limit instead of trusting it", async () => {
    await fetch(`${baseUrl}${PATH}?limit=1000000`);
    expect(getRegenerationHistory.mock.calls[0]![1]).toBe(20);
  });

  it("ignores a nonsense ?limit rather than passing NaN down", async () => {
    for (const bad of ["abc", "-4", "0", ""]) {
      vi.clearAllMocks();
      getRegenerationHistory.mockReturnValue([]);
      await fetch(`${baseUrl}${PATH}?limit=${bad}`);
      expect(getRegenerationHistory.mock.calls[0]![1]).toBe(20);
    }
  });

  it("honours a sensible ?limit", async () => {
    await fetch(`${baseUrl}${PATH}?limit=3`);
    expect(getRegenerationHistory.mock.calls[0]![1]).toBe(3);
  });
});

/* ── The republish button ───────────────────────────────────────────────── */

describe(`POST ${PATH}`, () => {
  beforeEach(() => {
    authState.agencyId = AGENCY_ID;
  });

  it("answers 202, not 200 — the work is queued, not finished", async () => {
    const res = await fetch(`${baseUrl}${PATH}`, { method: "POST" });

    expect(res.status).toBe(202);
    expect((await readJson<{ regeneration: { id: string } }>(res)).regeneration.id).toBe(
      "receipt-2",
    );
  });

  it("regenerates every scope, with the agency's own slug and domain", async () => {
    await fetch(`${baseUrl}${PATH}`, { method: "POST" });

    // Every scope, because the button exists for the agency that does not know
    // what is stale — it just knows the site looks wrong.
    expect(queueRegeneration.mock.calls[0]![0]).toEqual({
      agencyId: AGENCY_ID,
      slug: "himalayan-trails",
      customDomain: "everest-treks.com",
      scopes: ["branding", "siteConfig", "navigation"],
    });
  });

  it("404s an agency that does not exist, without leaking why", async () => {
    getAgencyBrandContext.mockRejectedValue(
      Object.assign(new Error("Agency not found"), { status: 404 }),
    );

    const res = await fetch(`${baseUrl}${PATH}`, { method: "POST" });

    expect(res.status).toBe(404);
    expect(queueRegeneration).not.toHaveBeenCalled();
  });
});
