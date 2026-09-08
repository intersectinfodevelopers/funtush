import { Router } from "express";
import type { Request, Response } from "express";
import {
  getActiveIncidents,
  getIncidentHistory,
  addAdminNote,
  exportIncident,
} from "../../services/sosMonitoring.service";
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

// GET /admin/sos/active — live feed
router.get("/active", async (_req: Request, res: Response) => {
  try {
    const data = await getActiveIncidents();
    res.json(data);
  } catch (err) {
    console.error("[GET /admin/sos/active]", err);
    res.status(500).json({ error: "Failed to load active SOS incidents" });
  }
});

// GET /admin/sos/history — past incidents
router.get("/history", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const data  = await getIncidentHistory(limit);
    res.json(data);
  } catch (err) {
    console.error("[GET /admin/sos/history]", err);
    res.status(500).json({ error: "Failed to load SOS history" });
  }
});

// POST /admin/sos/:id/notes — admin observation note
router.post("/:id/notes", async (req: Request, res: Response) => {
  try {
    const { note } = req.body as { note?: string };
    if (!note || typeof note !== "string" || note.trim() === "") {
      res.status(400).json({ error: "note is required" });
      return;
    }
    const result = await addAdminNote(paramId(req), adminId(req), note);
    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    console.error("[POST /admin/sos/:id/notes]", err);
    res.status(500).json({ error: "Failed to add note" });
  }
});

// GET /admin/sos/:id/export — structured law-enforcement export
router.get("/:id/export", async (req: Request, res: Response) => {
  try {
    const incidentId = paramId(req);
    const data = await exportIncident(incidentId);

    await writeAuditLog({
      action: "AGENCY_VIEWED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "sos_incident", target_id: incidentId,
      metadata: { exported: true, purpose: "law_enforcement" },
    });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="sos-incident-${incidentId}.json"`);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    console.error("[GET /admin/sos/:id/export]", err);
    res.status(500).json({ error: "Failed to export incident" });
  }
});

export default router;