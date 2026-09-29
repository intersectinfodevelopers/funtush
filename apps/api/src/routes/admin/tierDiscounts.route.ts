import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "@funtush/auth";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware";
import { writeAuditLog } from "../../services/auditLog.service.js";
import {
  listDiscountCodes,
  createDiscountCode,
  updateDiscountCode,
  deleteDiscountCode,
  TierDiscountError,
} from "../../services/tierDiscount.service.js";

const router = Router();

router.use(requireAuth, requirePlatformPermission("tiers"));

function pid(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}
function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}
function adminId(req: Request): string {
  return req.user?.userId ?? "unknown-admin";
}
function fail(res: Response, err: unknown) {
  if (err instanceof TierDiscountError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

/**
 * @openapi
 * /admin/tier-discounts:
 *   get:
 *     tags: [Admin]
 *     summary: List subscription-tier discount codes
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Codes } }
 *   post:
 *     tags: [Admin]
 *     summary: Create a subscription-tier discount code
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created }, 400: { description: Validation failed }, 409: { description: Code already exists } }
 * /admin/tier-discounts/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update a discount code (activate/deactivate, dates, limit, value)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated }, 404: { description: Not found } }
 *   delete:
 *     tags: [Admin]
 *     summary: Delete a discount code that has never been redeemed
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 204: { description: Deleted }, 400: { description: Has real redemptions — deactivate instead }, 404: { description: Not found } }
 */
router.get("/", async (_req, res) => {
  res.json({ success: true, data: await listDiscountCodes() });
});

router.post("/", async (req, res) => {
  try {
    const created = await createDiscountCode(req.body ?? {});
    await writeAuditLog({
      action: "TIER_DISCOUNT_CODE_CREATED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "tier_discount_code", target_id: created.id,
      metadata: { code: created.code, discountType: created.discountType, discountValue: String(created.discountValue) },
    });
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const updated = await updateDiscountCode(pid(req), req.body ?? {});
    await writeAuditLog({
      action: "TIER_DISCOUNT_CODE_UPDATED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "tier_discount_code", target_id: updated.id,
      metadata: { patch: req.body ?? {} },
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = pid(req);
    await deleteDiscountCode(id);
    await writeAuditLog({
      action: "TIER_DISCOUNT_CODE_DELETED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "tier_discount_code", target_id: id,
    });
    res.status(204).send();
  } catch (e) {
    fail(res, e);
  }
});

export default router;
