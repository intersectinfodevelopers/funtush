import { Router } from "express";
import { requireAuth } from "@funtush/auth";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware";
import { parsePagination, buildMeta } from "../../utils/pagination.js";
import {
  getFraudQueue,
  countFraudQueue,
  confirmFraud,
  dismissFraud,
  getBanRegistry,
  countBanRegistry,
} from "../../services/fraud.service.js";

const router = Router();

// Was gated only by the IP allow-list (`requireAdmin` on the parent router) —
// require a real platform-admin session too, matching every other admin route.
router.use(requireAuth, requirePlatformPermission("fraud"));

/**
 * @openapi
 * /admin/fraud/queue:
 *   get:
 *     tags: [Admin]
 *     summary: Pending fraud flags, strongest signal first (RED → ORANGE → YELLOW)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ data: FraudFlag[], total }" }, 403: { description: Admin only } }
 * /admin/fraud/ban-registry:
 *   get:
 *     tags: [Admin]
 *     summary: Every permanently banned account with reason + timestamp
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ data, total }" }, 403: { description: Admin only } }
 * /admin/fraud/{id}/confirm:
 *   patch:
 *     tags: [Admin]
 *     summary: Confirm a flag — permanently ban the account and blocklist its fingerprint / IP / email
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     requestBody:
 *       content: { application/json: { schema: { type: object, properties: { reason: { type: string } } } } }
 *     responses: { 200: { description: Confirmed }, 404: { description: Flag not found }, 409: { description: Already resolved } }
 * /admin/fraud/{id}/dismiss:
 *   patch:
 *     tags: [Admin]
 *     summary: Dismiss a flag — clear it, reset the account's risk score, notify the agency
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Dismissed }, 404: { description: Flag not found }, 409: { description: Already resolved } }
 */

// GET /admin/fraud/queue � flagged accounts, strongest signal first
router.get("/queue", async (req, res) => {
  try {
    const page = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const [queue, total] = await Promise.all([getFraudQueue({ skip: page.skip, take: page.take }), countFraudQueue()]);
    res.json({ data: queue, total, meta: buildMeta(total, page.page, page.limit) });
  } catch (err) {
    console.error("[GET /admin/fraud/queue]", err);
    res.status(500).json({ error: "Failed to fetch fraud queue" });
  }
});

// GET /admin/fraud/ban-registry � all permanently banned accounts
router.get("/ban-registry", async (req, res) => {
  try {
    const page = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const [registry, total] = await Promise.all([getBanRegistry({ skip: page.skip, take: page.take }), countBanRegistry()]);
    res.json({ data: registry, total, meta: buildMeta(total, page.page, page.limit) });
  } catch (err) {
    console.error("[GET /admin/fraud/ban-registry]", err);
    res.status(500).json({ error: "Failed to fetch ban registry" });
  }
});

// PATCH /admin/fraud/:id/confirm � ban account + blocklist fingerprint/IP/email
router.patch("/:id/confirm", async (req, res) => {
  try {
    const { reason } = req.body as { reason?: string };
    const updated = await confirmFraud(req.params.id, reason);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("already"))   { res.status(409).json({ error: msg }); return; }
    console.error("[PATCH /admin/fraud/:id/confirm]", err);
    res.status(500).json({ error: "Failed to confirm fraud flag" });
  }
});

// PATCH /admin/fraud/:id/dismiss � clear flag, reset risk, notify agency
router.patch("/:id/dismiss", async (req, res) => {
  try {
    const updated = await dismissFraud(req.params.id);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("already"))   { res.status(409).json({ error: msg }); return; }
    console.error("[PATCH /admin/fraud/:id/dismiss]", err);
    res.status(500).json({ error: "Failed to dismiss fraud flag" });
  }
});

export default router;
