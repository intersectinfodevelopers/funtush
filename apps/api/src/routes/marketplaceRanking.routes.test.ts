import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the ranked / compare marketplace routes. The ranking
 * service and token verification are mocked; a real Express app on a socket.
 * Covers: routes mounted, `/agencies/compare` resolves before `/agencies/:slug`,
 * optional-trekker personalisation, and the compare 400 passthrough.
 */

const { auth } = vi.hoisted(() => ({ auth: { token: undefined as string | undefined } }));

vi.mock("@funtush/auth", () => ({
  verifyAccessToken: (token: string) => {
    if (token !== "trekker-token") throw new Error("bad token");
    return { userId: "u-trek", role: "TREKKER", roleType: "TREKKER" };
  },
}));

const rankAgencies = vi.fn();
const compareAgencies = vi.fn();
vi.mock("../services/marketplaceRanking.service.js", () => ({
  rankAgencies: (...a: unknown[]) => rankAgencies(...a),
  compareAgencies: (...a: unknown[]) => compareAgencies(...a),
}));

// Other services the controller imports — stub so the module loads.
vi.mock("../services/search.service.js", () => ({ searchMarketplacePackages: vi.fn() }));
vi.mock("../services/marketplaceDirectory.service.js", () => ({
  getAgencyProfile: vi.fn(),
  listDestinations: vi.fn(),
  getDestinationBySlug: vi.fn(),
}));
vi.mock("../services/marketplaceCuration.service.js", () => ({
  getFeatured: vi.fn(),
  getTrending: vi.fn(),
  getSeasonal: vi.fn(),
}));
vi.mock("../services/marketplaceAnalytics.service.js", () => ({
  recordImpression: vi.fn(),
  recordClick: vi.fn(),
}));
vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: routes } = await import("./marketplace.routes");
  const app = express();
  app.use(express.json());
  app.use("/", routes);
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
  auth.token = undefined;
  rankAgencies.mockResolvedValue({
    trekkedWith: [],
    recommended: [{ slug: "a", score: 80 }],
    meta: { total: 1, personalised: false },
  });
  compareAgencies.mockResolvedValue([{ slug: "a" }, { slug: "b" }]);
});

function get(path: string, token?: string) {
  return fetch(`${baseUrl}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
}
async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("GET /marketplace/agencies (ranked)", () => {
  it("answers anonymous callers with a non-personalised list", async () => {
    const res = await get("/agencies");
    expect(res.status).toBe(200);
    expect(rankAgencies).toHaveBeenCalledWith(
      expect.objectContaining({ trekkerId: null }),
    );
  });

  it("personalises when a valid trekker token is present", async () => {
    const res = await get("/agencies?region=Everest&min_rating=4.5", "trekker-token");
    expect(res.status).toBe(200);
    expect(rankAgencies).toHaveBeenCalledWith({
      trekkerId: "u-trek",
      filters: expect.objectContaining({ region: "Everest", minRating: 4.5 }),
    });
  });

  it("ignores a bad token rather than 401-ing", async () => {
    const res = await get("/agencies", "garbage");
    expect(res.status).toBe(200);
    expect(rankAgencies).toHaveBeenCalledWith(expect.objectContaining({ trekkerId: null }));
  });

  it("upper-cases the tier filter", async () => {
    await get("/agencies?tier=large");
    expect(rankAgencies).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ tier: "LARGE" }) }),
    );
  });
});

describe("GET /marketplace/agencies/compare", () => {
  it("resolves to the compare handler, not the :slug profile", async () => {
    const res = await get("/agencies/compare?slugs=a,b,c");
    expect(res.status).toBe(200);
    expect(compareAgencies).toHaveBeenCalledWith(["a", "b", "c"], null);
    const body = await readJson<{ data: unknown[] }>(res);
    expect(body.data).toHaveLength(2);
  });

  it("passes the trekker id through for personalised history", async () => {
    await get("/agencies/compare?slugs=a,b", "trekker-token");
    expect(compareAgencies).toHaveBeenCalledWith(["a", "b"], "u-trek");
  });

  it("surfaces the service's 400 for < 2 slugs", async () => {
    compareAgencies.mockRejectedValueOnce(
      Object.assign(new Error("Pick between 2 and 4 agencies to compare"), { status: 400 }),
    );
    const res = await get("/agencies/compare?slugs=a");
    expect(res.status).toBe(400);
    const body = await readJson<{ success: boolean; message: string }>(res);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/2 and 4/);
  });
});
