import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * POST /marketplace/click is public and unauthenticated, so everything in the body is untrusted.
 *   BUG-203 (QA): wrong-type values (agencyId as a number, destination as a boolean, searchQuery as an array)
 *                 reached the database layer and returned 500 instead of 400.
 *   BUG-204 (QA): 52 rapid identical clicks were all counted (totalClicks 17 → 69).
 */

const recordClick = vi.fn();
const claimOnce = vi.fn();

vi.mock("@funtush/auth", () => ({ verifyAccessToken: vi.fn(() => { throw new Error("no token"); }) }));
vi.mock("../services/search.service.js", () => ({ searchMarketplacePackages: vi.fn() }));
vi.mock("../services/redis.service.js", () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  claimOnce: (...args: unknown[]) => claimOnce(...args),
}));
vi.mock("../services/marketplaceDirectory.service.js", () => ({
  getAgencyProfile: vi.fn(),
  getPackageBySlug: vi.fn(),
  listDestinations: vi.fn(),
  getDestinationBySlug: vi.fn(),
}));
vi.mock("../services/analytics.service.js", () => ({ trackEvent: vi.fn() }));
vi.mock("../services/marketplaceCuration.service.js", () => ({
  getFeatured: vi.fn(),
  getTrending: vi.fn(),
  getSeasonal: vi.fn(),
  getMarketplaceStats: vi.fn(),
}));
vi.mock("../services/marketplaceAnalytics.service.js", () => ({
  recordImpression: vi.fn(),
  recordClick: (...args: unknown[]) => recordClick(...args),
}));
vi.mock("../services/marketplaceRanking.service.js", () => ({ rankAgencies: vi.fn(), compareAgencies: vi.fn() }));
vi.mock("../services/recommendation.service.js", () => ({ getRecommendationsFor: vi.fn() }));

import { recordMarketplaceClick } from "./marketplace.controller";

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function click(body: unknown, headers: Record<string, string> = {}, ip = "203.0.113.7"): Promise<Reply> {
  const reply: Reply = { status: 0, body: {} };
  const res = {
    status(code: number) {
      reply.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      reply.body = payload;
      return this;
    },
  } as unknown as Response;
  await recordMarketplaceClick({ body, headers, ip } as unknown as Request, res);
  return reply;
}

const AGENCY = "8d12de61-0638-47d1-9538-8d6df76cfd3d";

beforeEach(() => {
  vi.clearAllMocks();
  claimOnce.mockResolvedValue(true);
  recordClick.mockResolvedValue({ id: "click-1" });
});

describe("BUG-203 — validation (400, never 500)", () => {
  it.each([
    ["no body at all", undefined, "agencyId is required"],
    ["empty object", {}, "agencyId is required"],
    ["a JSON array body", [], "agencyId is required"],
    ["agencyId as a number", { agencyId: 123, destination: "agency-profile" }, "agencyId must be a string"],
    ["agencyId as an object", { agencyId: { a: 1 }, destination: "agency-profile" }, "agencyId must be a string"],
    ["agencyId with bad characters", { agencyId: "a b;DROP TABLE", destination: "agency-profile" }, "agencyId is not a valid agency id"],
    ["agencyId too long", { agencyId: "a".repeat(65), destination: "agency-profile" }, "agencyId is not a valid agency id"],
    ["destination missing", { agencyId: AGENCY }, "destination is required (e.g. 'agency-profile', 'inquiry-form')"],
    ["destination as a boolean", { agencyId: AGENCY, destination: true }, "destination must be a string"],
    ["destination too long", { agencyId: AGENCY, destination: "d".repeat(101) }, "destination must be 1-100 characters"],
    ["searchQuery as an array", { agencyId: AGENCY, destination: "agency-profile", searchQuery: ["everest"] }, "searchQuery must be a string"],
    ["searchQuery too long", { agencyId: AGENCY, destination: "agency-profile", searchQuery: "q".repeat(201) }, "searchQuery must be at most 200 characters"],
  ])("400s %s", async (_label, body, message) => {
    const reply = await click(body);
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ success: false, message });
    expect(recordClick).not.toHaveBeenCalled();
    expect(claimOnce).not.toHaveBeenCalled();
  });

  it("records a valid click (trimmed) with 201", async () => {
    const reply = await click({ agencyId: ` ${AGENCY} `, destination: " agency-profile ", searchQuery: "  everest  " });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ success: true, clickId: "click-1" });
    expect(recordClick).toHaveBeenCalledWith(AGENCY, undefined, "agency-profile", "everest");
  });

  it("treats a blank searchQuery as absent", async () => {
    await click({ agencyId: AGENCY, destination: "agency-profile", searchQuery: "   " });
    expect(recordClick).toHaveBeenCalledWith(AGENCY, undefined, "agency-profile", undefined);
  });

  it("404s a well-formed id that matches no agency (foreign-key violation), not 500", async () => {
    recordClick.mockRejectedValue(Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" }));
    const reply = await click({ agencyId: "00000000-0000-0000-0000-000000000000", destination: "agency-profile" });
    expect(reply.status).toBe(404);
    expect(reply.body).toMatchObject({ success: false, message: "Agency not found" });
  });

  it("still 500s a genuine server failure", async () => {
    recordClick.mockRejectedValue(new Error("db down"));
    const reply = await click({ agencyId: AGENCY, destination: "agency-profile" });
    expect(reply.status).toBe(500);
  });
});

describe("BUG-204 — identical rapid clicks count once", () => {
  it("ignores a duplicate (200, deduplicated) without recording it", async () => {
    claimOnce.mockResolvedValue(false);
    const reply = await click({ agencyId: AGENCY, destination: "agency-profile" });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ success: true, deduplicated: true });
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("52 identical requests increment the counter once (QA's reproduction: 17 → 69)", async () => {
    const seen = new Set<string>();
    claimOnce.mockImplementation(async (key: string) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (let i = 0; i < 52; i++) await click({ agencyId: AGENCY, destination: "agency-profile" });
    expect(recordClick).toHaveBeenCalledTimes(1);
  });

  it("uses a 30-second window", async () => {
    await click({ agencyId: AGENCY, destination: "agency-profile" });
    expect(claimOnce.mock.calls[0][1]).toBe(30);
  });

  it("keys on visitor + agency + destination + query: any difference is a different click", async () => {
    const key = async (body: Record<string, unknown>, headers: Record<string, string> = {}, ip?: string) => {
      claimOnce.mockClear();
      await click(body, headers, ip);
      return claimOnce.mock.calls[0][0] as string;
    };
    const base = { agencyId: AGENCY, destination: "agency-profile" };

    const k = await key(base);
    expect(await key(base)).toBe(k); // same visitor, same click → same key
    expect(await key({ ...base, destination: "inquiry-form" })).not.toBe(k);
    expect(await key({ ...base, agencyId: "another-agency" })).not.toBe(k);
    expect(await key({ ...base, searchQuery: "everest" })).not.toBe(k);
    expect(await key(base, {}, "198.51.100.9")).not.toBe(k); // a different IP
    expect(await key(base, { "user-agent": "other-browser" })).not.toBe(k);
    expect(await key(base, { "x-visitor-id": "visitor-A" })).not.toBe(await key(base, { "x-visitor-id": "visitor-B" }));
  });

  it("fails open: if the dedupe store throws, the click is still recorded", async () => {
    claimOnce.mockRejectedValue(new Error("redis down"));
    const reply = await click({ agencyId: AGENCY, destination: "agency-profile" });
    expect(reply.status).toBe(201);
    expect(recordClick).toHaveBeenCalledTimes(1);
  });
});
