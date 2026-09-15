/**
 * ── Navigation builder routes (White-label week · Day 3) ─────────────────────
 *
 * Mounted at `/` in `src/index.ts`, next to the Day 1 branding router and the
 * Day 2 site-config router, so the dashboard paths sit beside their siblings
 * (`/agencies/me/branding`, `/agencies/me/site-config`,
 * `/agencies/me/navigation`) and the public paths share one namespace
 * (`/site/:slug/branding`, `/site/:slug/config`, `/site/:slug/navigation`).
 *
 * Middleware order on the write, cheapest guard first:
 *
 *   1. `authenticateWithRefreshToken` — who is calling? Sets `req.agencyId`.
 *   2. `checkAgencyStatus` — may this account write at all? A LOCKED agency is
 *      read-only (Backend Guide §6), and that includes its navigation — a
 *      locked agency's public site is not being served regardless of what its
 *      menu says, so there is nothing to gain from letting it edit one.
 *   3. `validate(navigationUpdateSchema)` — is the body well-formed?
 *   4. controller → service, which applies the tier rules.
 *
 * As on Day 1 and Day 2 there is deliberately **no `tierGate`**. The menu
 * builder and the Book Now button are Medium+, but a Small-tier agency still
 * has a *read* of its (fixed) navigation, and `tierGate` would reject the
 * whole request rather than the one field a tier does not have. Per-field
 * tier rules need a per-field enforcer, which is the service.
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import { validate } from "../middleware/validate";
import { navigationUpdateSchema } from "../validations/navigation.validation";
import {
  getMyNavigation,
  getMyNavigationOptions,
  getNavigationBySlug,
  patchMyNavigation,
} from "../controllers/navigation.controller";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/navigation:
 *   get: { tags: [Navigation], summary: Get the agency's own site navigation, security: [{ refreshToken: [] }], responses: { 200: { description: Navigation } } }
 *   patch: { tags: [Navigation], summary: Update the site navigation (menu items, Book Now button — some fields Medium+), security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 400: { description: Validation failed } } }
 * /agencies/me/navigation/options:
 *   get: { tags: [Navigation], summary: Get the tier-gated navigation options available to this agency, security: [{ refreshToken: [] }], responses: { 200: { description: Options } } }
 * /site/{slug}/navigation:
 *   get: { tags: [Navigation], summary: "Public: navigation menu for an agency's published site", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Navigation } } }
 */
router
  .route("/agencies/me/navigation")
  .get(authenticateWithRefreshToken, getMyNavigation)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    validate(navigationUpdateSchema),
    patchMyNavigation,
  );

router
  .route("/agencies/me/navigation/options")
  .get(authenticateWithRefreshToken, getMyNavigationOptions);

/**
 * Public — no auth, no `requireSiteLive`. See the controller's doc comment for
 * why this stays reachable even on a coming-soon page.
 */
router.route("/site/:slug/navigation").get(getNavigationBySlug);

export default router;
