/**
 * ── Social-links routes (backend catch-up pass) ───────────────────────────────
 *
 * Mounted at `/` in `src/app.ts`, next to `brandingRoutes`/`siteConfigRoutes`,
 * so the paths sit beside their siblings: `/agencies/me/social-links` and the
 * public `/site/:slug/social-links`.
 *
 * Middleware order on the write, cheapest guard first:
 *
 *   1. `authenticateWithRefreshToken` — who is calling? Sets `req.agencyId`.
 *   2. `checkAgencyStatus` — may this account write at all? A LOCKED agency
 *      is read-only (Backend Guide §6).
 *   3. `validate(socialLinksUpdateSchema)` — is the body well-formed?
 *   4. controller → service.
 *
 * No multer (nothing here is a file) and no `tierGate` (nothing here is a
 * paid feature) — same reasoning Day 1/2 give for their own absence.
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import { validate } from "../middleware/validate";
import { socialLinksUpdateSchema } from "../validations/socialLinks.validation";
import {
  getMySocialLinks,
  patchMySocialLinks,
  getSiteSocialLinks,
} from "../controllers/socialLinks.controller";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/social-links:
 *   get: { tags: [Social Links], summary: Get the agency's own social links, security: [{ refreshToken: [] }], responses: { 200: { description: Links } } }
 *   patch: { tags: [Social Links], summary: Update social links, security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 400: { description: Validation failed } } }
 * /site/{slug}/social-links:
 *   get: { tags: [Social Links], summary: "Public: social links for an agency's published site", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Links } } }
 */
router
  .route("/agencies/me/social-links")
  .get(authenticateWithRefreshToken, getMySocialLinks)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    validate(socialLinksUpdateSchema),
    patchMySocialLinks,
  );

/**
 * Public — no auth. These are the icons on a publicly visible website; an
 * anonymous visitor's first paint needs them.
 */
router.route("/site/:slug/social-links").get(getSiteSocialLinks);

export default router;
