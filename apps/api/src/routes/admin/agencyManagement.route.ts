import { Router } from "express";
import type { Request, Response } from "express";
import {
  listAgencies,
  getAgencyProfile,
  updateAgencyTier,
  updateAgencyStatus,
  issueImpersonationToken,
  updateAgencyPriorityOverride,
} from "../../services/adminAgency.service";
import { writeAuditLog } from "../../services/auditLog.service";
import { requireAdmin } from "../../middleware/requireAdmin.middleware";

const router = Router();

function clientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function adminId(req: Request): string {
  return req.user?.userId ?? "unknown-admin";
}


function paramId(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { tier, status, search, joinedFrom, joinedTo, page, limit } = req.query;
    const result = await listAgencies({
      tier:       tier       as string | undefined,
      status:     status     as string | undefined,
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

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = paramId(req);
    const profile = await getAgencyProfile(id);
    if (!profile) { res.status(404).json({ error: "Agency not found" }); return; }

    writeAuditLog({
      action: "AGENCY_VIEWED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: id,
    });
    res.json(profile);
  } catch (err) {
    console.error("[GET /admin/agencies/:id]", err);
    res.status(500).json({ error: "Failed to load agency profile" });
  }
});

router.patch("/:id/tier", async (req: Request, res: Response) => {
  try {
    const id = paramId(req);
    const { tier } = req.body as { tier?: string };
    if (!tier || typeof tier !== "string") {
      res.status(400).json({ error: "tier is required" });
      return;
    }
    const updated = await updateAgencyTier(id, tier.trim());

    await writeAuditLog({
      action: "AGENCY_TIER_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: id,
      metadata: { newTier: tier.trim() },
    });
    res.json(updated);
  } catch (err) {
    console.error("[PATCH /admin/agencies/:id/tier]", err);
    res.status(500).json({ error: "Failed to update agency tier" });
  }
});

router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const id = paramId(req);
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
    const updated = await updateAgencyStatus(id, status as ValidStatus);

    await writeAuditLog({
      action: "AGENCY_STATUS_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: id, reason: reason.trim(),
      metadata: { newStatus: status },
    });
    res.json(updated);
  } catch (err) {
    console.error("[PATCH /admin/agencies/:id/status]", err);
    res.status(500).json({ error: "Failed to update agency status" });
  }
});

router.patch("/:id/visibility", requireAdmin, async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== "SUPER_ADMIN" || req.user?.roleType !== "PLATFORM") {
      res.status(403).json({ error: "Super admin only" });
      return;
    }

    const id = paramId(req);
    const { admin_override } = req.body as { admin_override?: number };

    if (
      admin_override === undefined ||
      typeof admin_override !== "number" ||
      !Number.isInteger(admin_override) ||
      admin_override < 0
    ) {
      res.status(400).json({ error: "admin_override must be a non-negative integer" });
      return;
    }

    const result = await updateAgencyPriorityOverride(id, admin_override);

    await writeAuditLog({
      action: "AGENCY_VISIBILITY_OVERRIDE_CHANGED",
      actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: id,
      metadata: { admin_override, finalScore: result.finalScore, sponsored: result.sponsored },
    });

    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    console.error("[PATCH /admin/agencies/:id/visibility]", err);
    res.status(500).json({ error: "Failed to update agency visibility" });
  }
});

router.post("/:id/impersonate", async (req: Request, res: Response) => {
  try {
    const id = paramId(req);
    const result = await issueImpersonationToken(id, adminId(req));

    await writeAuditLog({
      action: "AGENCY_IMPERSONATED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: id,
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