import type { Request, Response } from "express";
import { verifyAccessToken } from "@funtush/auth";
import { searchMarketplacePackages } from "../services/search.service.js";

/**
 * ── Marketplace search controller (Week 3 · Day 2) ──────────────────────────
 *
 * Public endpoint: GET /marketplace/packages
 *
 * Parses + validates the query string, optionally identifies a logged-in
 * trekker (for personalization), then delegates ranking/pagination to the
 * search service. The endpoint is PUBLIC — anyone can browse the marketplace —
 * so a missing or invalid token is fine; it just means "no personalization".
 */

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

/**
 * If the request carries a valid trekker access token, return that trekker's
 * user id. Never throws — an absent/expired/invalid token just yields undefined
 * because this endpoint is open to the public.
 */
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

    // difficulty is case-insensitive in the API (?difficulty=moderate) but the
    // index stores the enum value (MODERATE).
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
      trekkerUserId: optionalTrekkerUserId(req),
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

    return res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return res.status(500).json({ success: false, message });
  }
};
