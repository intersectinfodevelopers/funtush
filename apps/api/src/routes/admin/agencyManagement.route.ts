import { Router } from "express";
import { createSupportHandoff } from "../../services/supportHandoff.service";
import type { Request, Response } from "express";
import {
  listAgencies,
  getAgencyProfile,
  updateAgencyTier,
  updateAgencyStatus,
  impersonateAgency,
  revokeImpersonation,
  updateAgencyPriorityOverride,
} from "../../services/adminAgency.service";
import { writeAuditLog } from "../../services/auditLog.service";
import { requireAdmin } from "../../middleware/requireAdmin.middleware";
import { requireAuth } from "@funtush/auth";
import { issueBreakGlassToken, revokeBreakGlass } from "../../services/breakGlass.service";
import { requireSuperAdminRole } from "../../middleware/requireSuperAdminRole.middleware";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware";
import { sendSupportAccessNotificationEmail } from "../../utils/email";

const router = Router();

function clientIp(req: Request): string {
  return (
    req.ip ||
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

// GET / and GET /:id are read-only agency data — delegable to a
// PLATFORM_SUPPORT user granted the "agencies" permission. Previously these
// two relied only on the parent router's IP allow-list (`requireAdmin`),
// with no real auth check at all — closed here alongside the permission work.
router.get("/", requireAuth, requirePlatformPermission("agencies"), async (req: Request, res: Response) => {
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

router.get("/:id", requireAuth, requirePlatformPermission("agencies"), async (req: Request, res: Response) => {
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

// Tier/status changes are consequential (billing + account standing) —
// kept SUPER_ADMIN/PLATFORM_ADMIN-only, not delegable via the "agencies"
// permission. Previously ungated beyond the IP allow-list; closed here.
router.patch("/:id/tier", requireAuth, requireSuperAdminRole, async (req: Request, res: Response) => {
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

router.patch("/:id/status", requireAuth, requireSuperAdminRole, async (req: Request, res: Response) => {
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

// `requireAdmin` (the IP-whitelist gate every /admin/* path already has via
// the parent router) plus `requireAuth` + `requireSuperAdminRole` (a real
// platform-admin JWT, `Authorization: Bearer`) — the same two-gate stack
// `admin/adCampaigns.route.ts` uses for its budget-affecting mutations.
// Previously this checked `req.user?.role` inline without ever running
// `requireAuth`, so `req.user` was always `undefined` and the route was
// permanently unreachable (a 403 regardless of who called it).
router.patch(
  "/:id/visibility",
  requireAdmin,
  requireAuth,
  requireSuperAdminRole,
  async (req: Request, res: Response) => {
  try {
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

// A real, working agency session comes out of this — see impersonateAgency's
// doc comment for why the previous version (an inert cached token nothing
// ever exchanged for anything) never actually granted access to anything.
// Because this now genuinely does, it carries the same two-gate stack
// `/:id/visibility` uses: requireAdmin's IP whitelist alone is not enough
// for something this powerful.
router.post(
  "/:id/impersonate",
  requireAdmin,
  requireAuth,
  requireSuperAdminRole,
  async (req: Request, res: Response) => {
  try {
    const id = paramId(req);
    const { reason } = req.body as { reason?: string };
    if (!reason || typeof reason !== "string" || reason.trim() === "") {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const trimmedReason = reason.trim();
    const result = await impersonateAgency(id, adminId(req));

    await writeAuditLog({
      action: "AGENCY_IMPERSONATED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: id, reason: trimmedReason,
      metadata: {
        expiresAt: result.expiresAt,
        agencyName: result.agencyName,
        impersonatedUserId: result.impersonatedUserId,
        impersonatedEmail: result.impersonatedEmail,
      },
    });

    void sendSupportAccessNotificationEmail(
      result.impersonatedEmail,
      result.agencyName,
      trimmedReason,
      new Date(),
    );

    // One-time code for opening the agency's real dashboard in a new tab (tokens never go in a URL).
    const handoffCode = await createSupportHandoff({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      agencyId: result.agencyId,
      agencyName: result.agencyName,
      impersonatedEmail: result.impersonatedEmail,
      expiresAt: result.expiresAt,
    });

    res.status(201).json({ ...result, handoffCode });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found") || msg.includes("no AGENCY_ADMIN")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("banned")) { res.status(403).json({ error: msg }); return; }
    console.error("[POST /admin/agencies/:id/impersonate]", err);
    res.status(500).json({ error: "Failed to start impersonation session" });
  }
});

// Ends the agency's active session before its natural 1-hour expiry — see
// revokeImpersonation's doc comment for why this works against stateless
// JWTs (a Redis pointer, not the tokens themselves). Same two-gate stack as
// starting a session.
router.delete(
  "/:id/impersonate",
  requireAdmin,
  requireAuth,
  requireSuperAdminRole,
  async (req: Request, res: Response) => {
  try {
    const id = paramId(req);
    await revokeImpersonation(id);

    await writeAuditLog({
      action: "AGENCY_IMPERSONATION_REVOKED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "agency", target_id: id,
    });

    res.status(200).json({ revoked: true });
  } catch (err) {
    console.error("[DELETE /admin/agencies/:id/impersonate]", err);
    res.status(500).json({ error: "Failed to revoke impersonation session" });
  }
});

// Break-glass: admin-authorised recovery for an agency owner who can't use
// "Forgot password". Returns a single-use code ONCE, for the admin to hand to
// the verified owner out-of-band (see breakGlass.service.ts). Same two-gate stack
// as impersonation, and a reason is mandatory.
router.post(
  "/:id/break-glass",
  requireAdmin,
  requireAuth,
  requireSuperAdminRole,
  async (req: Request, res: Response) => {
  try {
    const { reason } = (req.body ?? {}) as { reason?: unknown };
    if (typeof reason !== "string" || reason.trim() === "") {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const result = await issueBreakGlassToken({ agencyId: paramId(req), adminId: adminId(req), ip: clientIp(req), reason });
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status) { res.status(status).json({ error: (err as Error).message }); return; }
    console.error("[POST /admin/agencies/:id/break-glass]", err);
    res.status(500).json({ error: "Failed to issue break-glass code" });
  }
});

router.delete(
  "/:id/break-glass",
  requireAdmin,
  requireAuth,
  requireSuperAdminRole,
  async (req: Request, res: Response) => {
  try {
    res.status(200).json(await revokeBreakGlass({ agencyId: paramId(req), adminId: adminId(req), ip: clientIp(req) }));
  } catch (err) {
    console.error("[DELETE /admin/agencies/:id/break-glass]", err);
    res.status(500).json({ error: "Failed to revoke break-glass code" });
  }
});

export default router;
