import { Router } from "express";
import type { Request, Response } from "express";
import {
  listAgencies,
  getAgencyProfile,
  updateAgencyTier,
  updateAgencyStatus,
  issueImpersonationToken,
} from "../../services/adminAgency.service";
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

// GET /admin/agencies — paginated + filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { tier, status, country, search, joinedFrom, joinedTo, page, limit } = req.query;
    const result = await listAgencies({
      tier:       tier       as string | undefined,
      status:     status     as string | undefined,
      country:    country    as string | undefined,
      search:     search     as string | undefined,
      joinedFrom: joinedFrom as string | undefined,
      joinedTo:   joinedTo   as string | undefined,
      page:       page  ? parseInt(page  as string, 10) : undefined,
      limit:      limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error("[GET /admin/agencies]", err);
    res.status(500).json({ error: "Failed to list agencies" });
  }
});

// GET /admin/agencies/:id — full profile
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const profile = await getAgencyProfile(req.params.id);
    if (!profile) { res.status(404).json({ error: "Agency not found" }); return; }

    writeAuditLog({
      action: "AGENCY_VIEWED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: req.params.id,
    });
    res.json(profile);
  } catch (err) {
    console.error("[GET /admin/agencies/:id]", err);
    res.status(500).json({ error: "Failed to load agency profile" });
  }
});


router.patch("/:id/tier", async (req: Request, res: Response) => {
  try {
    const { tier } = req.body as { tier?: string };
    if (!tier || typeof tier !== "string") {
      res.status(400).json({ error: "tier is required" });
      return;
    }
    const updated = await updateAgencyTier(req.params.id, tier.trim());

    await writeAuditLog({
      action: "AGENCY_TIER_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: req.params.id,
      metadata: { newTier: tier.trim() },
    });
    res.json(updated);
  } catch (err) {
    console.error("[PATCH /admin/agencies/:id/tier]", err);
    res.status(500).json({ error: "Failed to update agency tier" });
  }
});

// PATCH /admin/agencies/:id/status — mandatory reason
router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const { status, reason } = req.body as { status?: string; reason?: string };
    const valid = ["ACTIVE", "SUSPENDED", "LOCKED"] as const;
    type ValidStatus = typeof valid[number];

    if (!status || !(valid as readonly string[]).includes(status)) {
      res.status(400).json({ error: `status must be one of: ${valid.join(", ")}` });
      return;
    }
    if (!reason || typeof reason !== "string" || reason.trim() === "") {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const updated = await updateAgencyStatus(req.params.id, status as ValidStatus, reason.trim());

    await writeAuditLog({
      action: "AGENCY_STATUS_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: req.params.id, reason: reason.trim(),
      metadata: { newStatus: status },
    });
    res.json(updated);
  } catch (err) {
    console.error("[PATCH /admin/agencies/:id/status]", err);
    res.status(500).json({ error: "Failed to update agency status" });
  }
});

// POST /admin/agencies/:id/impersonate
router.post("/:id/impersonate", async (req: Request, res: Response) => {
  try {
    const result = await issueImpersonationToken(req.params.id, adminId(req));

    await writeAuditLog({
      action: "AGENCY_IMPERSONATED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: req.params.id,
      metadata: { expiresAt: result.expiresAt },
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    console.error("[POST /admin/agencies/:id/impersonate]", err);
    res.status(500).json({ error: "Failed to issue impersonation token" });
  }
});

export default router;
