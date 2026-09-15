import type { Request, Response } from "express";
import { verifyAccessToken } from "@funtush/auth";
import { searchMarketplacePackages } from "../services/search.service.js";
import {
  getAgencyProfile,
  listDestinations,
  getDestinationBySlug,
} from "../services/marketplaceDirectory.service.js";
import {
  getFeatured,
  getTrending,
  getSeasonal,
} from "../services/marketplaceCuration.service.js";
import {
  recordImpression,
  recordClick,
} from "../services/marketplaceAnalytics.service.js";
import {
  rankAgencies,
  compareAgencies,
} from "../services/marketplaceRanking.service.js";

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

export const recordMarketplaceClick = async (req: Request, res: Response) => {
  try {
    const { agencyId, destination, searchQuery } = req.body;
    const trekkerUserId = optionalTrekkerUserId(req);

    if (!agencyId) {
      return res.status(400).json({
        success: false,
        message: "agencyId is required",
      });
    }

    if (!destination) {
      return res.status(400).json({
        success: false,
        message: "destination is required (e.g. 'agency-profile', 'inquiry-form')",
      });
    }

    const click = await recordClick(
      agencyId,
      trekkerUserId,
      destination,
      searchQuery
    );

    return res.status(201).json({
      success: true,
      message: "Click recorded",
      clickId: click.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record click";
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
    const result = await rankAgencies({
      trekkerId: trekkerUserId ?? null,
      filters: {
        search: asString(req.query.search),
        tier: asString(req.query.tier)?.toUpperCase(),
        region: asString(req.query.region),
        minRating: asNumber(req.query.min_rating),
        limit: asNumber(req.query.limit),
      },
    });
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
    const agency = await getAgencyProfile(req.params.slug as string);
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
    const result = await listDestinations({
      region: asString(req.query.region),
      altitudeMin: asNumber(req.query.altitude_min),
      altitudeMax: asNumber(req.query.altitude_max),
      season: asString(req.query.season),
      page: asNumber(req.query.page),
      limit: asNumber(req.query.limit),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load destinations";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/destinations/:slug — master destination page. */
export const getDestination = async (req: Request, res: Response) => {
  try {
    const destination = await getDestinationBySlug(req.params.slug as string);
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
    const data = await getFeatured();
    return res.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load featured content";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/trending — packages with the most inquiries in the last 7 days. */
export const trending = async (_req: Request, res: Response) => {
  try {
    const data = await getTrending();
    return res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load trending packages";
    return res.status(500).json({ success: false, message });
  }
};

/** GET /marketplace/seasonal — packages whose best season matches the current month. */
export const seasonal = async (_req: Request, res: Response) => {
  try {
    const data = await getSeasonal();
    return res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load seasonal packages";
    return res.status(500).json({ success: false, message });
  }
};