/**
 * ── Page-builder routes (backend catch-up pass, Phase 8) ──────────────────────
 *
 * Mounted at `/` in `app.ts`, next to the rest of the White-label-week
 * siblings, so the dashboard paths sit beside theirs (`/agencies/me/branding`,
 * `/agencies/me/navigation`, `/agencies/me/site-page`) and the public paths
 * share one namespace (`/site/:slug/branding`, `/site/:slug/navigation`,
 * `/site/:slug/site-page`).
 *
 * Middleware order on the writes, cheapest guard first:
 *
 *   1. `authenticateWithRefreshToken` — who is calling? Sets `req.agencyId`.
 *   2. `checkAgencyStatus` — may this account write at all? A LOCKED agency's
 *      public site is not being served, so there is nothing to gain from
 *      letting it keep editing the page.
 *   3. `validate(schema)` — is the body well-formed?
 *   4. controller → service, which applies the paid-template tier rule.
 *
 * No `tierGate` here, matching Day 1–3: a FREE-tier agency still has a full
 * read and write of its page, it just cannot switch to a paid template — a
 * per-field rule, enforced by the service, not a whole-endpoint gate.
 *
 * The public read is the one thing this router does that its siblings don't:
 * it is mounted behind `requireSiteLive`. Branding/SiteConfig/Navigation are
 * chrome a visitor needs even on a coming-soon page; a page's sections are
 * the actual content the construction gate (and Phase 6's "never published"
 * gate) exist to hide.
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import { requireSiteLive } from "../middleware/siteLive.middleware";
import { validate } from "../middleware/validate";
import { applyTemplateSchema, sitePageUpdateSchema } from "../validations/sitePage.validation";
import {
  getMySitePage,
  getMySitePageOptions,
  getSitePageBySlug,
  patchMySitePage,
  postApplySiteTemplate,
} from "../controllers/sitePage.controller";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/site-page:
 *   get: { tags: [Site Page], summary: Get the agency's own page-builder content, security: [{ refreshToken: [] }], responses: { 200: { description: Page sections } } }
 *   patch: { tags: [Site Page], summary: Update the page-builder sections, security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 400: { description: Validation failed } } }
 * /agencies/me/site-page/options:
 *   get: { tags: [Site Page], summary: Get the tier-gated page-builder options available to this agency, security: [{ refreshToken: [] }], responses: { 200: { description: Options } } }
 * /agencies/me/site-page/apply-template:
 *   post: { tags: [Site Page], summary: Apply a page template (some templates are paid-tier only), security: [{ refreshToken: [] }], responses: { 200: { description: Applied }, 403: { description: Template requires a higher tier } } }
 * /site/{slug}/site-page:
 *   get: { tags: [Site Page], summary: "Public: page-builder content for an agency's published site (behind the site-live gate)", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Page sections }, 404: { description: Site not live/published } } }
 */
router
  .route("/agencies/me/site-page")
  .get(authenticateWithRefreshToken, getMySitePage)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    validate(sitePageUpdateSchema),
    patchMySitePage,
  );

router.route("/agencies/me/site-page/options").get(authenticateWithRefreshToken, getMySitePageOptions);

router
  .route("/agencies/me/site-page/apply-template")
  .post(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    validate(applyTemplateSchema),
    postApplySiteTemplate,
  );

/**
 * Public — no auth, but **behind `requireSiteLive`**. See the file header for
 * why this route differs from every sibling's public read.
 */
router.route("/site/:slug/site-page").get(requireSiteLive, getSitePageBySlug);

export default router;
