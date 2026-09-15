/**
 * ── SEO-settings routes (backend catch-up pass) ───────────────────────────────
 *
 * Mounted at `/` in `src/app.ts`, next to the other white-label-settings
 * routers. Same middleware order as `socialLinks.routes.ts`, same reasoning
 * for the absent multer/`tierGate`.
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import { validate } from "../middleware/validate";
import { seoSettingsUpdateSchema } from "../validations/seoSettings.validation";
import {
  getMySeoSettings,
  patchMySeoSettings,
  getSiteSeoSettings,
} from "../controllers/seoSettings.controller";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/seo:
 *   get: { tags: [SEO], summary: Get the agency's own SEO settings, security: [{ refreshToken: [] }], responses: { 200: { description: Settings } } }
 *   patch: { tags: [SEO], summary: Update the agency's SEO settings, security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 400: { description: Validation failed } } }
 * /site/{slug}/seo:
 *   get: { tags: [SEO], summary: "Public: SEO meta tags for an agency's published site", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: SEO tags } } }
 */
router
  .route("/agencies/me/seo")
  .get(authenticateWithRefreshToken, getMySeoSettings)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    validate(seoSettingsUpdateSchema),
    patchMySeoSettings,
  );

/** Public — no auth. A page's `<title>`/`<meta>` tags need this on every render. */
router.route("/site/:slug/seo").get(getSiteSeoSettings);

export default router;
