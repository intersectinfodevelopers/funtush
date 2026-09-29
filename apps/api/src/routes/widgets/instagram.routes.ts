/**
 * ── Instagram OAuth connect flow (API-wide docs/test pass, Batch 0) ──────────
 *
 * Before this pass, every route here was registered with zero handlers
 * (`router.route(path).get()`, no callback) — mounted, reachable, and
 * silently doing nothing. The actual OAuth logic was already fully written
 * in `controllers/widgets/instagram.controller.ts` (authorize redirect,
 * authorization-code exchange, long-lived token exchange, persistence via
 * `saveInstagramConnectionService`) — it just was never imported here. This
 * file only wires that existing code to these paths; nothing below invents
 * new behaviour.
 *
 * `/auth/instagram` and `/auth/instagram/connect` both start the same OAuth
 * redirect. There is no separate "status" concept anywhere in
 * `instagram.service.ts` for `/auth/instagram` to have meant on its own, so
 * rather than invent one, it's treated as an alias of `/connect` — the
 * conservative reading that uses only code that already exists.
 *
 * `connectInstagramController` reads `req.agencyId`, so it needs
 * `authenticateWithRefreshToken` first (unlike `tierGate`, which reads
 * `req.tenantId` off `resolveTenant`'s global middleware). Tier-gated to
 * LARGE, matching `widgets.routes.ts`'s `PATCH /instagram` — there is no
 * reason to send a non-LARGE agency through Instagram's consent screen for a
 * feature it can't enable afterward.
 *
 * The callback is deliberately **not** behind either guard: it's the URL
 * Instagram itself redirects the browser to, with no session cookie or
 * refresh token attached — the agency id travels via the `state` query
 * param the connect step set, exactly as OAuth's authorization-code flow
 * expects.
 */

import { Router } from "express";
import {
  connectInstagramController,
  instagramCallbackController,
} from "src/controllers/widgets/instagram.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
import { tierGate } from "src/middleware/tierGateCheck.middleware";

const router = Router();

/**
 * @openapi
 * /auth/instagram/connect:
 *   get: { tags: [Widgets], summary: "Start the Instagram OAuth connect flow (Large tier)", security: [{ refreshToken: [] }], responses: { 302: { description: Redirect to Instagram's consent screen }, 403: { description: Tier gate } } }
 * /auth/instagram:
 *   get: { tags: [Widgets], summary: "Alias of /auth/instagram/connect", security: [{ refreshToken: [] }], responses: { 302: { description: Redirect to Instagram's consent screen }, 403: { description: Tier gate } } }
 * /auth/instagram/oauth-callback:
 *   get: { tags: [Widgets], summary: "Instagram's OAuth redirect target (no auth — agency id travels via the state param)", responses: { 200: { description: Connected }, 400: { description: Invalid/expired state or code } } }
 */
router
  .route("/auth/instagram/connect")
  .get(authenticateWithRefreshToken, tierGate(["LARGE"]), connectInstagramController);

router
  .route("/auth/instagram")
  .get(authenticateWithRefreshToken, tierGate(["LARGE"]), connectInstagramController);

router.route("/auth/instagram/oauth-callback").get(instagramCallbackController);

export default router;
