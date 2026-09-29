/**
 * ── Email-settings routes (backend catch-up pass) ─────────────────────────────
 *
 * Mounted at `/` in `src/app.ts`. Only `/agencies/me/...` — no public
 * `/site/:slug/...` route, matching `notificationPreferences.routes.ts` for
 * the same reason (see `data/emailSettings.ts`).
 *
 * Middleware order matches every sibling: auth → status guard → validate →
 * controller. No multer, no tierGate.
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import { validate } from "../middleware/validate";
import { emailSettingsUpdateSchema } from "../validations/emailSettings.validation";
import { getMyEmailSettings, patchMyEmailSettings } from "../controllers/emailSettings.controller";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/email-settings:
 *   get: { tags: [Email Settings], summary: Get the agency's own transactional-email settings, security: [{ refreshToken: [] }], responses: { 200: { description: Settings } } }
 *   patch: { tags: [Email Settings], summary: Update transactional-email settings, security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 400: { description: Validation failed } } }
 */
router
  .route("/agencies/me/email-settings")
  .get(authenticateWithRefreshToken, getMyEmailSettings)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    validate(emailSettingsUpdateSchema),
    patchMyEmailSettings,
  );

export default router;
