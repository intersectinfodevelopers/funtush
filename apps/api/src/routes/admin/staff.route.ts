import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "@funtush/auth";
import { requireSuperAdminRole } from "../../middleware/requireSuperAdminRole.middleware.js";
import { writeAuditLog } from "../../services/auditLog.service.js";
import {
  listPlatformStaff,
  createPlatformStaff,
  updatePlatformStaffRole,
  updatePlatformStaffPermissions,
  setPlatformStaffActive,
  deletePlatformStaff,
  PlatformStaffError,
} from "../../services/platformStaff.service.js";
import { groupedPlatformPermissionCatalog } from "../../config/platformPermissionCatalog.js";

const router = Router();

// Who can manage the platform's own team is at least as sensitive as tier
// config — same gate as tiers.route.ts.
router.use(requireAuth, requireSuperAdminRole);

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
  if (err instanceof PlatformStaffError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res
    .status(400)
    .json({ success: false, message: err instanceof Error ? err.message : "Something went wrong" });
}

/**
 * @openapi
 * /admin/staff:
 *   get:
 *     tags: [Admin]
 *     summary: List platform staff (SUPER_ADMIN / PLATFORM_ADMIN / PLATFORM_SUPPORT)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Staff } }
 *   post:
 *     tags: [Admin]
 *     summary: Invite a new platform staff member (emails a temp password)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created }, 400: { description: Invalid role/email }, 409: { description: Email already exists } }
 * /admin/staff/{id}/role:
 *   patch:
 *     tags: [Admin]
 *     summary: Change a platform staff member's role
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated }, 400: { description: Invalid role or last SUPER_ADMIN }, 404: { description: Not found } }
 * /admin/staff/permissions:
 *   get:
 *     tags: [Admin]
 *     summary: Catalog of admin modules a PLATFORM_SUPPORT member can be granted (powers the invite/edit checkboxes)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Grouped permission catalog } }
 * /admin/staff/{id}/permissions:
 *   patch:
 *     tags: [Admin]
 *     summary: Replace a platform staff member's module permissions (audit-logged)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, required: [permissions], properties: { permissions: { type: array, items: { type: string } } } } } } }
 *     responses: { 200: { description: Updated }, 400: { description: Invalid permissions, or target is not a PLATFORM_SUPPORT account }, 404: { description: Not found } }
 * /admin/staff/{id}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Activate or deactivate a platform staff member (reason required)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated }, 400: { description: Missing reason, self-deactivation, or last SUPER_ADMIN }, 404: { description: Not found } }
 * /admin/staff/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Permanently delete a platform staff member — only once already deactivated
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 204: { description: Deleted }, 400: { description: Still active, or has real bug-triage history }, 404: { description: Not found } }
 */
// Catalog of admin modules a PLATFORM_SUPPORT member can be granted — powers
// the permission checkboxes on the invite/edit forms.
router.get("/permissions", (_req, res) => {
  res.json({ success: true, data: groupedPlatformPermissionCatalog() });
});

router.get("/", async (_req, res) => {
  res.json({ success: true, data: await listPlatformStaff() });
});

router.post("/", async (req, res) => {
  try {
    const { email, role, permissions } = req.body ?? {};
    const created = await createPlatformStaff(email, role, permissions);
    await writeAuditLog({
      action: "PLATFORM_STAFF_CREATED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "platform_staff", target_id: created.id,
      metadata: { email: created.email, role: created.role, permissions: created.permissions },
    });
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/:id/permissions", async (req, res) => {
  try {
    const { permissions } = req.body ?? {};
    const updated = await updatePlatformStaffPermissions(pid(req), permissions);
    await writeAuditLog({
      action: "PLATFORM_STAFF_PERMISSIONS_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "platform_staff", target_id: updated.id,
      metadata: { permissions: updated.permissions },
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/:id/role", async (req, res) => {
  try {
    const { role } = req.body ?? {};
    const updated = await updatePlatformStaffRole(adminId(req), pid(req), role);
    await writeAuditLog({
      action: "PLATFORM_STAFF_ROLE_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "platform_staff", target_id: updated.id,
      metadata: { newRole: updated.role },
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const { isActive, reason } = req.body ?? {};
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ success: false, message: "isActive (boolean) is required" });
    }
    if (!reason || typeof reason !== "string" || reason.trim() === "") {
      return res.status(400).json({ success: false, message: "reason is required" });
    }
    const updated = await setPlatformStaffActive(adminId(req), pid(req), isActive);
    await writeAuditLog({
      action: "PLATFORM_STAFF_STATUS_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "platform_staff", target_id: updated.id, reason: reason.trim(),
      metadata: { isActive: updated.isActive },
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = pid(req);
    await deletePlatformStaff(adminId(req), id);
    await writeAuditLog({
      action: "PLATFORM_STAFF_DELETED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "platform_staff", target_id: id,
    });
    res.status(204).send();
  } catch (e) {
    fail(res, e);
  }
});

export default router;
