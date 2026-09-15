import { Router } from "express";
import { requireApiKey } from "../middleware/apiKeyAuth.middleware";
import { publicApiRateLimit } from "../middleware/publicApiRateLimit.middleware";
import { listPublicPackagesController, listPublicBookingsController } from "../controllers/publicApi.controller";

const router = Router();

/**
 * @openapi
 * /public-api/v1/packages:
 *   get:
 *     tags: [Public API]
 *     summary: List the calling agency's packages (X-Api-Key auth, rate-limited)
 *     parameters: [{ name: page, in: query, schema: { type: integer } }, { name: limit, in: query, schema: { type: integer } }]
 *     responses: { 200: { description: Packages }, 401: { description: Missing/invalid API key } }
 * /public-api/v1/bookings:
 *   get:
 *     tags: [Public API]
 *     summary: List the calling agency's bookings (X-Api-Key auth, rate-limited)
 *     parameters: [{ name: status, in: query, schema: { type: string } }, { name: page, in: query, schema: { type: integer } }, { name: limit, in: query, schema: { type: integer } }]
 *     responses: { 200: { description: Bookings }, 401: { description: Missing/invalid API key } }
 */
router.get("/packages", requireApiKey, publicApiRateLimit, listPublicPackagesController);
router.get("/bookings", requireApiKey, publicApiRateLimit, listPublicBookingsController);

export default router;