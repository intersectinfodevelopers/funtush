/**
 * ── Domain & publish routes (backend catch-up pass) ───────────────────────────
 *
 * Mounted at `/` in `src/index.ts`, alongside `brandingRoutes` /
 * `siteConfigRoutes` / `navigationRoutes`.
 *
 * Two different gates are in play here, deliberately not the same one:
 *
 *   - `isPaidTier` guards **connecting/verifying/disconnecting a custom
 *     domain** — that's a whole-endpoint paid feature (every FREE-tier agency
 *     gets the same answer: upgrade first), unlike Day 1's colour-picker rule
 *     which is a per-field nuance living in the service layer.
 *   - Publish/unpublish carries **no** `isPaidTier` — every tier, including
 *     FREE, can put its (subdomain-only) site live. Only the *custom domain*
 *     is a paid feature, not the act of publishing itself.
 *
 * Middleware order on every write matches every sibling router in this pass:
 * `authenticateWithRefreshToken` → `checkAgencyStatus` → (`isPaidTier`) →
 * `validate(schema)` → controller.
 *
 * There is no public `/site/:slug/domain` read — nothing here is rendered on
 * the public site itself (the CNAME target and TXT record are dashboard-only
 * setup instructions, not page content), unlike Branding/SiteConfig/Navigation.
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus, isPaidTier } from "../middleware/agencyAccess.middleware";
import { validate } from "../middleware/validate";
import { connectDomainSchema } from "../validations/domain.validation";
import {
  deleteMyDomain,
  getMyDomain,
  patchMyDomain,
  publishMySite,
  unpublishMySite,
  verifyMyDomain,
} from "../controllers/domain.controller";

const router = express.Router();

router
  .route("/agencies/me/domain")
  .get(authenticateWithRefreshToken, getMyDomain)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    isPaidTier,
    validate(connectDomainSchema),
    patchMyDomain,
  )
  .delete(authenticateWithRefreshToken, checkAgencyStatus, isPaidTier, deleteMyDomain);

router
  .route("/agencies/me/domain/verify")
  .post(authenticateWithRefreshToken, checkAgencyStatus, isPaidTier, verifyMyDomain);

router.route("/agencies/me/publish").post(authenticateWithRefreshToken, checkAgencyStatus, publishMySite);

router.route("/agencies/me/unpublish").post(authenticateWithRefreshToken, checkAgencyStatus, unpublishMySite);

export default router;
