import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "@funtush/auth";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware";
import { getAuditLogs } from "../../services/auditLog.service";
import { AUDIT_ACTIONS, type AuditAction } from "../../models/auditLog.model";
import { prisma } from "@funtush/database";

const router = Router();

const str = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

/**
 * @openapi
 * /admin/audit-logs:
 *   get:
 *     tags: [Admin]
 *     summary: Immutable admin audit trail, newest first (super/platform admin only)
 *     description: Filter by action, actor, target. Page with `before` = the last row's `timestamp`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: action, in: query, schema: { type: string } }
 *       - { name: actor_id, in: query, schema: { type: string } }
 *       - { name: target_type, in: query, schema: { type: string } }
 *       - { name: target_id, in: query, schema: { type: string } }
 *       - { name: before, in: query, schema: { type: string, format: date-time } }
 *       - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 200, default: 50 } }
 *     responses:
 *       200: { description: "{ data: AuditLogEntry[], nextBefore: string | null, actions: string[] }" }
 *       400: { description: Invalid filter }
 *       403: { description: Requires platform admin privileges }
 */
router.get("/", requireAuth, requirePlatformPermission("audit_logs"), async (req: Request, res: Response) => {
  // Filters go into a Mongo query, so each must be a plain string (a query-string
  // object like ?actor_id[$ne]=x must never reach the driver as an operator).
  const q = req.query;
  const action = str(q.action);
  if (action !== undefined && !(AUDIT_ACTIONS as readonly string[]).includes(action)) {
    res.status(400).json({ error: "Unknown action" });
    return;
  }

  let before: Date | undefined;
  if (q.before !== undefined) {
    before = new Date(String(q.before));
    if (Number.isNaN(before.getTime())) {
      res.status(400).json({ error: "before must be an ISO date-time" });
      return;
    }
  }

  const limit = Math.min(200, Math.max(1, Number.parseInt(String(q.limit ?? "50"), 10) || 50));

  try {
    const rows = await getAuditLogs({
      action: action as AuditAction | undefined,
      actor_id: str(q.actor_id),
      target_type: str(q.target_type),
      target_id: str(q.target_id),
      before,
      limit: limit + 1, // one extra row tells us whether there is another page
    });
    const page = rows.slice(0, limit);

    // actor_id is a real User.id for every admin-initiated action, but a
    // handful of legacy fire-and-forget calls stamp it "unknown-admin" or an
    // IP — those just get no email back, not an error.
    const actorIds = [...new Set(page.map((r) => r.actor_id))];
    const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } });
    const emailById = new Map(actors.map((a) => [a.id, a.email]));

    res.json({
      data: page.map((r) => ({ ...r, id: String(r._id), _id: undefined, actor_email: emailById.get(r.actor_id) ?? null })),
      nextBefore: rows.length > limit ? page[page.length - 1].timestamp.toISOString() : null,
      actions: AUDIT_ACTIONS,
    });
  } catch (err) {
    console.error("[GET /admin/audit-logs]", err);
    res.status(500).json({ error: "Failed to load audit logs" });
  }
});

export default router;
