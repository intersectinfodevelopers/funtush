import { Router } from "express";
import type { Request, Response } from "express";
import {
  issueBreakGlass,
  listBreakGlass,
  revokeBreakGlass,
  BreakGlassError,
} from "../../services/breakGlass.service.js";

const router = Router();

function ipOf(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}
function actorOf(req: Request): string | null {
  const r = req as Request & { user?: { userId?: string }; adminId?: string };
  return r.user?.userId ?? r.adminId ?? null;
}
function fail(res: Response, err: unknown) {
  if (err instanceof BreakGlassError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  console.error("[admin/break-glass]", err);
  return res
    .status(500)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

/**
 * @openapi
 * /admin/break-glass:
 *   post:
 *     tags: [Admin]
 *     summary: Issue a time-limited emergency-access token for an agency
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [agencyId]
 *             properties:
 *               agencyId: { type: string }
 *               reason: { type: string }
 *               ttlSeconds: { type: integer, description: "default 1800, max 86400" }
 *     responses:
 *       201: { description: "{ token (shown once), expiresAt, breakGlass }" }
 *       400: { description: agencyId missing }
 *       404: { description: Agency not found }
 *   get:
 *     tags: [Admin]
 *     summary: List break-glass tokens (optionally by agency / active-only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: agencyId, in: query, schema: { type: string } }
 *       - { name: active, in: query, schema: { type: string, enum: ["true"] } }
 *     responses: { 200: { description: Tokens }, 403: { description: Admin only } }
 * /admin/break-glass/{id}/revoke:
 *   patch:
 *     tags: [Admin]
 *     summary: Revoke a break-glass token before it expires
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Revoked }, 404: { description: Not found }, 409: { description: Already revoked } }
 */

router.post("/", async (req, res) => {
  try {
    const { agencyId, reason, ttlSeconds } = req.body ?? {};
    if (!agencyId) {
      return res.status(400).json({ success: false, message: "agencyId is required" });
    }
    const result = await issueBreakGlass(String(agencyId), {
      issuedByIp: ipOf(req),
      issuedBy: actorOf(req),
      reason,
      ttlSeconds: typeof ttlSeconds === "number" ? ttlSeconds : undefined,
    });
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    fail(res, e);
  }
});

router.get("/", async (req, res) => {
  try {
    const agencyId = typeof req.query.agencyId === "string" ? req.query.agencyId : undefined;
    const activeOnly = req.query.active === "true";
    res.json({ success: true, data: await listBreakGlass({ agencyId, activeOnly }) });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/:id/revoke", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    res.json({ success: true, data: await revokeBreakGlass(id, ipOf(req)) });
  } catch (e) {
    fail(res, e);
  }
});

export default router;
