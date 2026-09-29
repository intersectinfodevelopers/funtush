import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "@funtush/auth";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware";
import { issueSafetyWarning } from "../../services/sosMonitoring.service";
import { writeAuditLog } from "../../services/auditLog.service";

const router = Router();

// Was gated only by the IP allow-list (`requireAdmin` on the parent router) —
// require a real platform-admin session too, matching every other admin route.
router.use(requireAuth, requirePlatformPermission("safety_warnings"));

function clientIp(req: Request): string {
  return (
    req.ip ||
    req.socket.remoteAddress ||
    "unknown"
  );
}
function adminId(req: Request): string {
  return (req as unknown as { adminId?: string }).adminId ?? "unknown-admin";
}
function paramId(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}

// POST /admin/safety-warnings/:id/warning — formal safety warning (permanent)
// (mounted at /admin/safety-warnings in admin/index.ts — the comment this
// replaced said /admin/agencies/:id/warning, which was never the real path)
router.post("/:id/warning", async (req: Request, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason || typeof reason !== "string" || reason.trim() === "") {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const warning = await issueSafetyWarning(paramId(req), adminId(req), reason);

    await writeAuditLog({
      action: "AGENCY_STATUS_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: paramId(req), reason: reason.trim(),
      metadata: { safetyWarning: true, warningId: warning.id },
    });
    res.status(201).json(warning);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    console.error("[POST /admin/agencies/:id/warning]", err);
    res.status(500).json({ error: "Failed to issue safety warning" });
  }
});

export default router;
