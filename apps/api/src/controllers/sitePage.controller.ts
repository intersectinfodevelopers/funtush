/**
 * ── Page-builder controllers (backend catch-up pass, Phase 8) ────────────────
 *
 * Thin, like every sibling in this pass: read the request, call the service,
 * shape the response. Every rule about *what is allowed* is in
 * `sitePage.service.ts`; every rule about *what is well-formed* is in
 * `validations/sitePage.validation.ts`.
 *
 * Cache policy mirrors Day 3's navigation controller: a section is page
 * content, not a logo — its blast radius on a stale cache is real, so the
 * public read gets the same short public cache Day 2/3 chose rather than
 * Day 1's minute-scale one.
 */

import type { Request, Response } from "express";
import {
  applySiteTemplate,
  getPublicSitePageBySlug,
  getSitePage,
  getSitePageOptions,
  updateSitePage,
} from "../services/sitePage.service";
import type { ApplyTemplateInput, SitePageUpdateInput } from "../validations/sitePage.validation";
import { cacheTagHeaderValue } from "../data/staticPages";

/** Dashboard reads: always fresh. */
const PRIVATE_NO_STORE = "private, no-store";

/** Public site reads: matches Day 2/3's 15s — real content, not chrome. */
const PUBLIC_SITE_CACHE = "public, max-age=15, stale-while-revalidate=60";

/** Turn a thrown service error into a status + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

function agencyIdOrUnauthorized(req: Request, res: Response): string | null {
  const agencyId = req.agencyId as string | undefined;
  if (!agencyId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return agencyId;
}

/** `GET /agencies/me/site-page` — the builder's current page. */
export async function getMySitePage(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const sitePage = await getSitePage(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: sitePage });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/site-page");
  }
}

/** `GET /agencies/me/site-page/options` — templates, section catalog, limits, tier notes. */
export async function getMySitePageOptions(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const options = await getSitePageOptions(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: options });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/site-page/options");
  }
}

/**
 * `PATCH /agencies/me/site-page` — edit chrome and/or replace the section
 * list. See the service's file header for why `sections` is a full replace
 * when sent rather than merged.
 */
export async function patchMySitePage(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const input = req.body as SitePageUpdateInput;
    const { regeneration, ...sitePage } = await updateSitePage(agencyId, input);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, message: "Page updated", data: sitePage, regeneration });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/site-page");
  }
}

/**
 * `POST /agencies/me/site-page/apply-template` — start over from a template.
 * Its own endpoint, not a PATCH field — see the service's file header.
 */
export async function postApplySiteTemplate(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const { templateId } = req.body as ApplyTemplateInput;
    const { regeneration, ...sitePage } = await applySiteTemplate(agencyId, templateId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, message: "Template applied", data: sitePage, regeneration });
  } catch (err) {
    respondWithError(res, err, "POST /agencies/me/site-page/apply-template");
  }
}

/**
 * `GET /site/:slug/site-page` — what the white-label renderer calls to draw
 * the homepage. Mounted behind `requireSiteLive` (see the routes file) since
 * this is real page content, unlike Day 1–3's chrome reads.
 */
export async function getSitePageBySlug(req: Request, res: Response): Promise<void> {
  try {
    const slug = String(req.params.slug ?? "").toLowerCase();
    if (!slug) {
      res.status(400).json({ success: false, message: "Site slug is required" });
      return;
    }

    const sitePage = await getPublicSitePageBySlug(slug);

    const etag = `"site-page-${slug}-${sitePage.updatedAt?.getTime() ?? "init"}"`;

    res.setHeader("Cache-Control", PUBLIC_SITE_CACHE);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Tag", cacheTagHeaderValue(slug, ["sitePage"]));

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).json({ success: true, data: sitePage });
  } catch (err) {
    respondWithError(res, err, "GET /site/:slug/site-page");
  }
}
