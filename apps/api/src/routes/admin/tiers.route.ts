import { Router } from "express";
import type { Request, Response } from "express";
import { listTiers, createTier, updateTier, TierConfigError } from "../../services/tierConfig.service.js";

const router = Router();

function pid(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}
function fail(res: Response, err: unknown) {
  if (err instanceof TierConfigError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

/**
 * @openapi
 * /admin/tiers:
 *   get:
 *     tags: [Admin]
 *     summary: List all subscription tiers with their full config
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Tiers }, 403: { description: Admin only } }
 *   post:
 *     tags: [Admin]
 *     summary: Create a subscription tier
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created }, 409: { description: Name taken } }
 * /admin/tiers/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update a tier's limits / pricing / feature flags (Concept doc §6)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated }, 404: { description: Not found } }
 */
router.get("/", async (_req, res) => {
  try {
    res.json({ success: true, data: await listTiers() });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/", async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await createTier(req.body ?? {}) });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    res.json({ success: true, data: await updateTier(pid(req), req.body ?? {}) });
  } catch (e) {
    fail(res, e);
  }
});

export default router;
