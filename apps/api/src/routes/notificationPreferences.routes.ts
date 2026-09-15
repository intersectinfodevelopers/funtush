/**
 * ── Notification-preferences routes (backend catch-up pass) ──────────────────
 *
 * Mounted at `/` in `src/app.ts`. Only `/agencies/me/...` paths — unlike every
 * sibling module in this pass, there is no public `/site/:slug/...` route
 * here, because nothing in this module is public white-label site content
 * (see `data/notifications.ts`).
 *
 * Middleware order on the write matches every sibling: auth → status guard →
 * validate → controller. No multer (nothing here is a file) and no tierGate
 * (nothing here is a paid feature).
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import { validate } from "../middleware/validate";
import { notificationPreferencesUpdateSchema } from "../validations/notificationPreferences.validation";
import {
  getMyNotificationPreferenceOptions,
  getMyNotificationPreferences,
  patchMyNotificationPreferences,
} from "../controllers/notificationPreferences.controller";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/notification-preferences:
 *   get: { tags: [Notification Preferences], summary: Get the agency's own notification preferences, security: [{ refreshToken: [] }], responses: { 200: { description: Preferences } } }
 *   patch: { tags: [Notification Preferences], summary: Update notification preferences, security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 400: { description: Validation failed } } }
 * /agencies/me/notification-preferences/options:
 *   get: { tags: [Notification Preferences], summary: Get the available notification-preference options, security: [{ refreshToken: [] }], responses: { 200: { description: Options } } }
 */
router
  .route("/agencies/me/notification-preferences")
  .get(authenticateWithRefreshToken, getMyNotificationPreferences)
  .patch(
    authenticateWithRefreshToken,
    checkAgencyStatus,
    validate(notificationPreferencesUpdateSchema),
    patchMyNotificationPreferences,
  );

router
  .route("/agencies/me/notification-preferences/options")
  .get(authenticateWithRefreshToken, getMyNotificationPreferenceOptions);

export default router;
