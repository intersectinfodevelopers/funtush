/**
 * ── Social-links controllers (backend catch-up pass) ──────────────────────────
 *
 * Thin, like Day 1/2's: read the request, call the service, shape the
 * response. Every rule about *what is well-formed* is in
 * `validations/socialLinks.validation.ts`; there are no tier or coherence
 * rules to enforce, so `socialLinks.service.ts` is thinner too.
 */

import type { Request, Response } from "express";
import {
  getPublicSocialLinksBySlug,
  getSocialLinks,
  updateSocialLinks,
} from "../services/socialLinks.service";
import type { SocialLinksUpdateInput } from "../validations/socialLinks.validation";
import { cacheTagHeaderValue } from "../data/staticPages";

/** Dashboard reads: always fresh. */
const PRIVATE_NO_STORE = "private, no-store";

/** Public site reads: same 60s as Day 1's branding — social links change as rarely. */
const PUBLIC_SITE_CACHE = "public, max-age=60, stale-while-revalidate=600";

/** Turn a thrown service error into a status + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

/** `GET /agencies/me/social-links` — the settings screen's current values. */
export async function getMySocialLinks(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const links = await getSocialLinks(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: links });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/social-links");
  }
}

/**
 * `PATCH /agencies/me/social-links`. JSON only, no multer — nothing here is a
 * file. PATCH, not PUT, so a client changing one link does not have to resend
 * the other four (and, per Day 2's sharper reason, does not silently reset
 * them if it forgets to).
 */
export async function patchMySocialLinks(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const input = req.body as SocialLinksUpdateInput;
    const { regeneration, ...links } = await updateSocialLinks(agencyId, input);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      message: "Social links updated",
      data: links,
      regeneration,
    });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/social-links");
  }
}

/** `GET /site/:slug/social-links` — what the white-label renderer calls. */
export async function getSiteSocialLinks(req: Request, res: Response): Promise<void> {
  try {
    const slug = String(req.params.slug ?? "").toLowerCase();
    if (!slug) {
      res.status(400).json({ success: false, message: "Site slug is required" });
      return;
    }

    const links = await getPublicSocialLinksBySlug(slug);

    const etag = `"social-${slug}-${links.updatedAt?.getTime() ?? "init"}"`;

    res.setHeader("Cache-Control", PUBLIC_SITE_CACHE);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Tag", cacheTagHeaderValue(slug, ["socialLinks"]));

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).json({ success: true, data: links });
  } catch (err) {
    respondWithError(res, err, "GET /site/:slug/social-links");
  }
}
