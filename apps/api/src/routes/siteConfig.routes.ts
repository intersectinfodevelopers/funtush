/**
 * ── Site configuration routes (White-label week · Day 2) ─────────────────────
 *
 * Mounted at `/` in `src/index.ts`, next to the Day 1 branding router, so the
 * dashboard paths sit beside their siblings (`/agencies/me/branding`,
 * `/agencies/me/site-config`) and the public paths share one namespace
 * (`/site/:slug/branding`, `/site/:slug/config`).
 *
 * Middleware order on the write, cheapest guard first:
 *
 *   1. `authenticateWithRefreshToken` — who is calling? Sets `req.agencyId`.
 *   2. `checkAgencyStatus` — may this account write at all? A LOCKED agency is
 *      read-only (Backend Guide §6). Worth pausing on: a locked agency cannot
 *      turn construction mode *off* either. That is intended — its site is
 *      already not being served, and letting it publish would route around the
 *      lock.
 *   3. `validate(siteConfigUpdateSchema)` — is the body well-formed?
 *   4. controller → service, which applies the tier and coherence rules.
 *
 * No multer: nothing here is a file, so the multipart parser is simply absent
 * rather than present-and-unused.
 *
 * As on Day 1 there is deliberately **no `tierGate`**. The popup is Medium+ but
 * the other three switches are not, and `tierGate` rejects the whole request —
 * a Small agency changing its announcement bar would get a 403 about popups.
 * Per-field tier rules need a per-field enforcer, which is the service.
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import { validate } from "../middleware/validate";
import { siteConfigUpdateSchema } from "../validations/siteConfig.validation";
import {
  getMySiteConfig,
  getMySiteConfigOptions,
  getSiteConfigBySlug,
  patchMySiteConfig,
} from "../controllers/siteConfig.controller";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/site-config:
 *   get: { tags: [Site Config], summary: Get the agency's own site configuration, security: [{ refreshToken: [] }], responses: { 200: { description: Config } } }
 *   patch: { tags: [Site Config], summary: Update site configuration (construction mode, announcement bar, popup — Medium+), security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 400: { description: Validation failed } } }
 * /agencies/me/site-config/options:
 *   get: { tags: [Site Config], summary: Get the tier-gated site-config options available to this agency, security: [{ refreshToken: [] }], responses: { 200: { description: Options } } }
 * /site/{slug}/config:
 *   get: { tags: [Site Config], summary: "Public: site configuration for an agency's published site (construction mode nulls topBar/popup)", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Config } } }
 */
router
  .route("/agencies/me/site-config")
  .get(authenticateWithRefreshToken, getMySiteConfig)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    validate(siteConfigUpdateSchema),
    patchMySiteConfig,
  );

router
  .route("/agencies/me/site-config/options")
  .get(authenticateWithRefreshToken, getMySiteConfigOptions);

/**
 * Public — no auth, and **no `requireSiteLive`**.
 *
 * This is the endpoint that *reports* construction mode, so guarding it with the
 * construction gate would make the state unreadable exactly when it matters. Its
 * payload is also safe to serve in that state: when the site is under
 * construction the service nulls out `topBar` and `popup` and returns only the
 * coming-soon copy, so there is no unpublished content to leak.
 *
 * `requireSiteLive` is instead mounted on the public site *content* routes —
 * see `src/middleware/siteLive.middleware.ts`.
 */
router.route("/site/:slug/config").get(getSiteConfigBySlug);

export default router;
