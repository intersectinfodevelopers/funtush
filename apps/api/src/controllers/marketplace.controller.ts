import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { verifyAccessToken } from "@funtush/auth";
import { searchMarketplacePackages } from "../services/search.service.js";
import { cacheGet, cacheSet, claimOnce } from "../services/redis.service.js";

import {
  getAgencyProfile,
  getPackageBySlug,
  listDestinations,
  getDestinationBySlug,
} from "../services/marketplaceDirectory.service.js";
import { trackEvent } from "../services/analytics.service.js";
import {
  getFeatured,
  getTrending,
  getSeasonal,
  getMarketplaceStats,
} from "../services/marketplaceCuration.service.js";
import {
  recordImpression,
  recordClick,
} from "../services/marketplaceAnalytics.service.js";
import {
  rankAgencies,
  compareAgencies,
} from "../services/marketplaceRanking.service.js";
import { getRecommendationsFor } from "../services/recommendation.service.js";

const MARKETPLACE_AGENCIES_TTL_SECONDS = 30;
// Public, non-personalised reads (featured/trending/seasonal/destinations/
// agency profile) change on the order of minutes, not seconds.
const PUBLIC_READ_TTL_SECONDS = 60;
const MAX_CACHE_KEY_LENGTH = 200;

/**
 * Read-through cache for public, identical-for-everyone responses. A null
 * loader result (a 404) is deliberately never cached, so a newly created
 * agency/destination shows up immediately instead of 404ing for a minute.
 */
async function cachedPublic<T>(res: Response, key: string, load: () => Promise<T | null>): Promise<T | null> {
  // Keys embed user-supplied filters/slugs; refuse to cache oversized ones so
  // a caller can't fill Redis with unique junk keys.
  if (key.length > MAX_CACHE_KEY_LENGTH) return load();
  const hit = await cacheGet<T>(`marketplace:public:${key}`);
  if (hit) {
    res.set("X-Cache", "HIT");
    return hit;
  }
  const value = await load();
  if (value !== null) {
    await cacheSet(`marketplace:public:${key}`, value, PUBLIC_READ_TTL_SECONDS);
    res.set("X-Cache", "MISS");
  }
  return value;
}

const VALID_DIFFICULTIES = new Set(["EASY", "MODERATE", "CHALLENGING", "DIFFICULT"]);

/** Read a query param as a single trimmed string, or undefined if absent/empty. */
function asString(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** Read a query param as a finite number, or undefined if absent/not a number. */
function asNumber(value: unknown): number | undefined {
  const str = asString(value);
  if (str === undefined) return undefined;
  const n = Number(str);
  return Number.isFinite(n) ? n : undefined;
}

/** A funtush-main-generated anonymous id (cookie-backed), sent on every marketplace read so
 *  browsing behavior can drive recommendations before a visitor ever logs in. */
function visitorId(req: Request): string | undefined {
  const v = req.headers["x-visitor-id"];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim().slice(0, 100) : undefined;
}

function optionalTrekkerUserId(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    return payload.roleType === "TREKKER" ? payload.userId : undefined;
  } catch {
    return undefined;
  }
}

export const searchMarketplace = async (req: Request, res: Response) => {
  try {
    const q = asString(req.query.q);
    const trekkerUserId = optionalTrekkerUserId(req);


    const difficultyRaw = asString(req.query.difficulty)?.toUpperCase();
    if (difficultyRaw && !VALID_DIFFICULTIES.has(difficultyRaw)) {
      return res.status(400).json({
        success: false,
        message: `Invalid difficulty. Allowed: ${[...VALID_DIFFICULTIES].join(", ")}`,
      });
    }

    const result = await searchMarketplacePackages({
      q,
      page: asNumber(req.query.page),
      limit: asNumber(req.query.limit),
      trekkerUserId, // For loyalty boost (Day 3)
      filters: {
        difficulty: difficultyRaw,
        priceMin: asNumber(req.query.price_min),
        priceMax: asNumber(req.query.price_max),
        durationMin: asNumber(req.query.duration_min),
        durationMax: asNumber(req.query.duration_max),
        altitudeMax: asNumber(req.query.altitude_max),
        season: asString(req.query.season),
        destination: asString(req.query.destination),
      },
    });

    const uniqueAgencyIds = [...new Set((result.data || []).map((pkg) => pkg.agencyId))];
    const impressionPromises = uniqueAgencyIds.map((agencyId) =>
      recordImpression(agencyId).catch((err) => {
        // Non-blocking: log but don't fail the search
        console.error(`Failed to record impression for agency ${agencyId}:`, err);
      })
    );

    Promise.all(impressionPromises).catch(() => {
    });

    const enrichedData = (result.data || []).map((pkg) => ({
      ...pkg,
    }));

    return res.json({
      success: true,
      ...result,
      data: enrichedData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return res.status(500).json({ success: false, message });
  }
};

const MAX_CLICK_AGENCY_ID_LENGTH = 64;
const MAX_CLICK_DESTINATION_LENGTH = 100;
const MAX_CLICK_SEARCH_QUERY_LENGTH = 200;
/** An identical click (same visitor, agency, destination, search) inside this window is not counted again. */
const CLICK_DEDUP_WINDOW_SECONDS = 30;

type ClickInput = { agencyId: string; destination: string; searchQuery?: string };

/**
 * Validates POST /marketplace/click. Every value arrives from a public, unauthenticated request, so it may be missing
 * or the wrong type; each of those is the caller's mistake (400), never a server error. (BUG-203: a number/boolean/array
 * used to reach the database layer and come back as a 500.)
 */
function parseClickBody(body: unknown): { ok: true; value: ClickInput } | { ok: false; message: string } {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  if (b.agencyId === undefined || b.agencyId === null || b.agencyId === "") {
    return { ok: false, message: "agencyId is required" };
  }
  if (typeof b.agencyId !== "string") return { ok: false, message: "agencyId must be a string" };
  const agencyId = b.agencyId.trim();
  if (!agencyId || agencyId.length > MAX_CLICK_AGENCY_ID_LENGTH || !/^[\w-]+$/.test(agencyId)) {
    return { ok: false, message: "agencyId is not a valid agency id" };
  }

  if (b.destination === undefined || b.destination === null || b.destination === "") {
    return { ok: false, message: "destination is required (e.g. 'agency-profile', 'inquiry-form')" };
  }
  if (typeof b.destination !== "string") return { ok: false, message: "destination must be a string" };
  const destination = b.destination.trim();
  if (!destination || destination.length > MAX_CLICK_DESTINATION_LENGTH) {
    return { ok: false, message: `destination must be 1-${MAX_CLICK_DESTINATION_LENGTH} characters` };
  }

  let searchQuery: string | undefined;
  if (b.searchQuery !== undefined && b.searchQuery !== null) {
    if (typeof b.searchQuery !== "string") return { ok: false, message: "searchQuery must be a string" };
    const q = b.searchQuery.trim();
    if (q.length > MAX_CLICK_SEARCH_QUERY_LENGTH) {
      return { ok: false, message: `searchQuery must be at most ${MAX_CLICK_SEARCH_QUERY_LENGTH} characters` };
    }
    searchQuery = q || undefined;
  }

  return { ok: true, value: { agencyId, destination, searchQuery } };
}

/**
 * True when this exact click was already counted a moment ago (BUG-204: 52 rapid identical requests used to add 52
 * clicks, inflating an agency's CTR). The "same visitor" is the signed-in trekker, else the anonymous visitor id,
 * else IP + user-agent — never IP alone, because behind a CDN many visitors share one address. Fails open.
 */
async function isDuplicateClick(req: Request, trekkerUserId: string | undefined, click: ClickInput): Promise<boolean> {
  try {
    const visitor =
      trekkerUserId ?? visitorId(req) ?? `${req.ip ?? "?"}|${String(req.headers["user-agent"] ?? "").slice(0, 120)}`;
    const digest = createHash("sha1")
      .update([visitor, click.agencyId, click.destination, click.searchQuery ?? ""].join("\u0000"))
      .digest("hex");
    return !(await claimOnce(`marketplace:click:${digest}`, CLICK_DEDUP_WINDOW_SECONDS));
  } catch {
    return false;
  }
}

export const recordMarketplaceClick = async (req: Request, res: Response) => {
  try {
    const parsed = parseClickBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, message: parsed.message });
    }
    const { agencyId, destination, searchQuery } = parsed.value;
    const trekkerUserId = optionalTrekkerUserId(req);

    if (await isDuplicateClick(req, trekkerUserId, parsed.value)) {
      return res.status(200).json({
        success: true,
        message: "Duplicate click ignored",
        deduplicated: true,
      });
    }

    const click = await recordClick(agencyId, trekkerUserId, destination, searchQuery);

    return res.status(201).json({
      success: true,
      message: "Click recorded",
      clickId: click.id,
    });
  } catch (err) {
    // A well-formed id that matches no agency violates the click's foreign key — the caller's mistake, not ours.
    if ((err as { code?: string } | null)?.code === "P2003") {
      return res.status(404).json({ success: false, message: "Agency not found" });
    }
    const message = err instanceof Error ? err.message : "Failed to record click";
    return res.status(500).json({ success: false, message });
  }
};

/**
 * GET /marketplace/packages/:slug — one package's public detail page.
 * Fires a real PAGE_VIEW event (trekker id when logged in, else the anonymous
 * `x-visitor-id` header) — the signal getRecommendations below reads back.
 */
export const getPackage = async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const pkg = await cachedPublic(res, `package:${slug}`, () => getPackageBySlug(slug));
    if (!pkg) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const trekkerUserId = optionalTrekkerUserId(req);
    const vid = visitorId(req);
    if (trekkerUserId || vid) {
      void trackEvent({
        agency_id: pkg.agency.id,
        event_type: "PAGE_VIEW",
        trekker_id: trekkerUserId ?? null,
        package_id: pkg.id,
        metadata: {
          visitor_id: vid ?? null,
          destination: pkg.destination ?? pkg.destinations[0]?.name ?? null,
          difficulty: pkg.difficulty,
        },
      });
    }

    return res.json({ success: true, data: pkg });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load package";
    return res.status(500).json({ success: false, message });
  }
};

/**
 * GET /marketplace/agencies
 *
 * KYC-verified, paid, ACTIVE agencies ranked by a composite score. When a
 * trekker's access token is present the list is personalised: agencies they
 * have completed a trek with come back in a `trekkedWith` group that always
 * sorts first, and every item carries a `yourHistory` summary.
 *
 * `?tier=`, `?region=`, `?min_rating=`, `?search=`, `?limit=` all narrow the
 * result. `page` is no longer meaningful — the response is a ranked shortlist,
 * not a paginated directory.
 */
export const getAgencies = async (req: Request, res: Response) => {
  try {
    const trekkerUserId = optionalTrekkerUserId(req);
    const filters = {
      search: asString(req.query.search),
      tier: asString(req.query.tier)?.toUpperCase(),
      region: asString(req.query.region),
      minRating: asNumber(req.query.min_rating),
      limit: asNumber(req.query.limit),
    };

    // Only anonymous requests are cached: a signed-in trekker's response is
    // personalised (`trekkedWith`/`yourHistory`), so it can't be shared. Short
    // TTL instead of invalidation — a ranking that's up to 30s stale is fine
    // for a public listing, and it keeps this the highest-traffic join-heavy
    // query from hitting Postgres on every page view.
    const rawKey = `marketplace:agencies:${JSON.stringify(filters)}`;
    const cacheKey = trekkerUserId || rawKey.length > MAX_CACHE_KEY_LENGTH ? null : rawKey;
    if (cacheKey) {
      const cached = await cacheGet<Awaited<ReturnType<typeof rankAgencies>>>(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return res.json({ success: true, ...cached });
      }
    }

    const result = await rankAgencies({ trekkerId: trekkerUserId ?? null, filters });
    if (cacheKey) {
      await cacheSet(cacheKey, result, MARKETPLACE_AGENCIES_TTL_SECONDS);
      res.set("X-Cache", "MISS");
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agencies";
    return res.status(500).json({ success: false, message });
  }
};

/**
 * GET /marketplace/agencies/compare?slugs=a,b,c
 *
 * Side-by-side data for 2-4 agencies the trekker picked. Non-verified agencies
 * are NOT hidden here (unlike the ranked list) — the trekker asked for these by
 * slug, and "not verified" is a comparison fact worth showing. Personalised
 * with `yourHistory` when a trekker token is present.
 */
export const compareMarketplaceAgencies = async (req: Request, res: Response) => {
  try {
    const raw = asString(req.query.slugs);
    const slugs = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const trekkerUserId = optionalTrekkerUserId(req);
    const data = await compareAgencies(slugs, trekkerUserId ?? null);
    return res.json({ success: true, data });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : "Failed to compare agencies";
    return res.status(status).json({ success: false, message });
  }
};

/** GET /marketplace/agencies/:slug — one agency's public profile. */
export const getAgency = async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const agency = await cachedPublic(res, `agency:${slug}`, () => getAgencyProfile(slug));
    if (!agency) {
      return res.status(404).json({ success: false, message: "Agency not found" });
    }
    return res.json({ success: true, data: agency });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agency";
    return res.status(500).json({ success: false, message });
  }
};

export const getDestinations = async (req: Request, res: Response) => {
  try {
    const params = {
      region: asString(req.query.region),
      altitudeMin: asNumber(req.query.altitude_min),
      altitudeMax: asNumber(req.query.altitude_max),
      season: asString(req.query.season),
      page: asNumber(req.query.page),
      limit: asNumber(req.query.limit),
    };
    const result = await cachedPublic(res, `destinations:${JSON.stringify(params)}`, () => listDestinations(params));
    return res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load destinations";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/destinations/:slug — master destination page. */
export const getDestination = async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const destination = await cachedPublic(res, `destination:${slug}`, () => getDestinationBySlug(slug));
    if (!destination) {
      return res.status(404).json({ success: false, message: "Destination not found" });
    }
    return res.json({ success: true, data: destination });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load destination";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/featured — Sponsored + highest-rated + most-booked-this-month mix. */
export const featured = async (_req: Request, res: Response) => {
  try {
    const data = await cachedPublic(res, "featured", getFeatured);
    return res.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load featured content";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/trending — packages with the most inquiries in the last 7 days. */
export const trending = async (_req: Request, res: Response) => {
  try {
    const data = (await cachedPublic(res, "trending", getTrending)) ?? [];
    return res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load trending packages";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/seasonal — packages whose best season matches the current month. */
export const seasonal = async (_req: Request, res: Response) => {
  try {
    const data = (await cachedPublic(res, "seasonal", getSeasonal)) ?? [];
    return res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load seasonal packages";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/stats — real platform-scale counts for the homepage (never fixed marketing numbers). */
export const stats = async (_req: Request, res: Response) => {
  try {
    const data = await cachedPublic(res, "marketplace:stats", getMarketplaceStats);
    return res.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load marketplace stats";
    return res.status(500).json({ success: false, message });
  }
};

/**
 * GET /marketplace/recommendations — behavior-driven "recommended for you",
 * personalised from real PAGE_VIEW history (trekker id once logged in, else the
 * anonymous `x-visitor-id` header); falls back to the curated featured mix for a
 * visitor with no history yet. Never cached — it's specific to one visitor.
 */
export const getRecommendations = async (req: Request, res: Response) => {
  try {
    const trekkerUserId = optionalTrekkerUserId(req) ?? null;
    const vid = visitorId(req) ?? null;
    const result = await getRecommendationsFor(trekkerUserId, vid);
    return res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load recommendations";
    return res.status(500).json({ success: false, message });
  }
};