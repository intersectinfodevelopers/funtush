import { Router } from "express";
import type { Request, Response } from "express";
import { issueSafetyWarning } from "../../services/sosMonitoring.service";
import { writeAuditLog } from "../../services/auditLog.service";

const router = Router();

function clientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
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

// POST /admin/agencies/:id/warning — formal safety warning (permanent)
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
