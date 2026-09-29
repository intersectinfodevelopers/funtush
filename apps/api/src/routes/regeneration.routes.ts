/**
 * ── Regeneration routes (White-label week · Day 4) ───────────────────────────
 *
 * Mounted at `/` in `src/index.ts` beside the Day 1–3 routers, so the whole
 * white-label surface lives under one prefix:
 *
 *   /agencies/me/branding          (Day 1)
 *   /agencies/me/site-config       (Day 2)
 *   /agencies/me/navigation        (Day 3)
 *   /agencies/me/site/regeneration (Day 4)
 *
 * The path is `/site/regeneration` rather than `/regeneration` because this is
 * about the agency's *published website*, not about the agency record — and the
 * next things that belong beside it (`/site/domain`, `/site/seo`) read correctly
 * in that namespace and would not under a flat one.
 *
 * Middleware, cheapest guard first, exactly as on Day 1–3:
 *
 *   - **GET** needs only `authenticateWithRefreshToken`. It is a read of this
 *     agency's own operational history, and a LOCKED agency must still be able
 *     to see it — a read-only account (Backend Guide §6) can look at everything
 *     it owns, and the account most likely to be asking "why is my site wrong?"
 *     is the one that has just been locked.
 *   - **POST** additionally needs `checkAgencyStatus`, because it makes the
 *     platform do work on behalf of a site that, for a LOCKED agency, is not
 *     being served at all.
 *
 * No `validate(...)`: neither endpoint has a body. The one input, `?limit`, is a
 * query parameter the controller clamps rather than parses — a zod schema for a
 * single optional integer would be ceremony, not safety.
 *
 * No `tierGate` either, for Day 1–3's reason plus a stronger one of its own:
 * regeneration is not a feature, it is the plumbing that makes *every* tier's
 * saves take effect. A Small-tier agency's colour change is exactly as entitled
 * to reach its visitors as a Large one's.
 */

import express from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "../middleware/agencyAccess.middleware";
import {
  getMyRegenerations,
  postMyRegeneration,
} from "../controllers/regeneration.controller";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/site/regeneration:
 *   get: { tags: [Site Regeneration], summary: List the agency's site regeneration history, security: [{ refreshToken: [] }], parameters: [{ name: limit, in: query, schema: { type: integer } }], responses: { 200: { description: History } } }
 *   post: { tags: [Site Regeneration], summary: Trigger a rebuild of the agency's published site, security: [{ refreshToken: [] }], responses: { 201: { description: Regeneration queued }, 403: { description: Locked agency } } }
 */
router
  .route("/agencies/me/site/regeneration")
  .get(authenticateWithRefreshToken, getMyRegenerations)
  .post(authenticateWithRefreshToken, checkAgencyStatus, postMyRegeneration);

export default router;
