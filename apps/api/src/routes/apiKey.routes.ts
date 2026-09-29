import express from "express";
import { createApiKeyController, listApiKeysController, revokeApiKeyController } from "../controllers/apiKey.controller";
import { requireAuth, requireRole } from "@funtush/auth";

const router = express.Router();

/**
 * @openapi
 * /agencies/me/api-keys:
 *   post:
 *     tags: [API Keys]
 *     summary: Create an API key for public-API access (Large tier only) — the raw key is returned exactly once
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created — includes the raw key, never retrievable again }
 *       400: { description: name is required }
 *       403: { description: Not on the Large tier }
 *   get:
 *     tags: [API Keys]
 *     summary: List the agency's API keys (prefix only — never the raw key or hash)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Keys } }
 * /agencies/me/api-keys/{id}:
 *   delete:
 *     tags: [API Keys]
 *     summary: Revoke an API key
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Revoked }
 *       403: { description: Owned by a different agency }
 *       404: { description: Not found }
 *       409: { description: Already revoked }
 */
router.post("/", requireAuth, requireRole(["AGENCY_ADMIN"]), createApiKeyController);
router.get("/", requireAuth, requireRole(["AGENCY_ADMIN"]), listApiKeysController);
router.delete("/:id", requireAuth, requireRole(["AGENCY_ADMIN"]), revokeApiKeyController);

export default router;