/**
 * ── SEO-settings controllers (backend catch-up pass) ──────────────────────────
 *
 * Thin, like Day 1/2's: read the request, call the service, shape the
 * response. See `socialLinks.controller.ts` for why there is no
 * caching/tier/coherence complexity to speak of beyond the standard
 * private-vs-public split.
 */

import type { Request, Response } from "express";
import {
  getPublicSeoSettingsBySlug,
  getSeoSettings,
  updateSeoSettings,
} from "../services/seoSettings.service";
import type { SeoSettingsUpdateInput } from "../validations/seoSettings.validation";
import { cacheTagHeaderValue } from "../data/staticPages";

/** Dashboard reads: always fresh. */
const PRIVATE_NO_STORE = "private, no-store";

/** Public site reads: same 60s as Day 1's branding — SEO copy changes as rarely. */
const PUBLIC_SITE_CACHE = "public, max-age=60, stale-while-revalidate=600";

/** Turn a thrown service error into a status + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

/** `GET /agencies/me/seo` — the settings screen's current values. */
export async function getMySeoSettings(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const settings = await getSeoSettings(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: settings });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/seo");
  }
}

/** `PATCH /agencies/me/seo`. JSON only, no multer. */
export async function patchMySeoSettings(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const input = req.body as SeoSettingsUpdateInput;
    const { regeneration, ...settings } = await updateSeoSettings(agencyId, input);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      message: "SEO settings updated",
      data: settings,
      regeneration,
    });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/seo");
  }
}

/** `GET /site/:slug/seo` — what the white-label renderer calls. */
export async function getSiteSeoSettings(req: Request, res: Response): Promise<void> {
  try {
    const slug = String(req.params.slug ?? "").toLowerCase();
    if (!slug) {
      res.status(400).json({ success: false, message: "Site slug is required" });
      return;
    }

    const settings = await getPublicSeoSettingsBySlug(slug);

    const etag = `"seo-${slug}-${settings.updatedAt?.getTime() ?? "init"}"`;

    res.setHeader("Cache-Control", PUBLIC_SITE_CACHE);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Tag", cacheTagHeaderValue(slug, ["seoSettings"]));

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).json({ success: true, data: settings });
  } catch (err) {
    respondWithError(res, err, "GET /site/:slug/seo");
  }
}
