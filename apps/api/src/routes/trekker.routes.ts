import { Router } from "express";
import { requireAuth, requireRole } from "@funtush/auth";
import { registerTrekker, trekkerPreference } from "src/controllers/Trekkers/trekker.controller";

const router = Router();

/**
 * SECURITY FIX: `PATCH /trekker-preferences` previously had **no auth at
 * all**, and took a `trekkerId` straight from the request body — any
 * caller could overwrite any other trekker's saved preferences (an IDOR
 * on top of having no auth to begin with). `requireRole(["TREKKER"])`
 * matches `mobile.routes.ts`'s own convention for trekker-only endpoints;
 * the controller now resolves the trekker id from the verified session
 * instead of trusting the body.
 */
/**
 * @openapi
 * /create/trekker:
 *   post: { tags: [Trekkers], summary: "Public: register a new trekker account", responses: { 201: { description: Registered }, 409: { description: Email already exists } } }
 * /trekker-preferences:
 *   patch: { tags: [Trekkers], summary: Set the signed-in trekker's own travel preferences (destinations, budget, group size), security: [{ bearerAuth: [] }], responses: { 200: { description: Saved }, 401: { description: Unauthorized } } }
 */
router.route('/create/trekker')
    .post(registerTrekker);

router.route('/trekker-preferences')
    .patch(requireAuth, requireRole(["TREKKER"]), trekkerPreference);

export default router;