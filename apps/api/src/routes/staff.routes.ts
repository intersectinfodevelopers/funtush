import { Router } from "express";
import { requireAuth, requireRole } from "@funtush/auth";
import { requireStaffPermission } from "../middleware/requireStaffPermission.middleware";
import { staffDelegationGuard } from "../middleware/staffDelegation.middleware";
import { checkImpersonationActive } from "../middleware/checkImpersonationActive.middleware";
import {
  addStaff,
  listStaff,
  reassignRole,
  updateStaff,
  deactivateStaff,
  reactivateStaff,
  getStaffActivity,
} from "../controllers/staff.controller";

const router = Router();

/**
 * @openapi
 * /agencies/me/staff:
 *   get: { tags: [Staff & Roles], summary: List all staff members (active and deactivated), security: [{ bearerAuth: [] }], responses: { 200: { description: Staff }, 401: { description: Unauthorized }, 403: { description: Forbidden } } }
 *   post:
 *     tags: [Staff & Roles]
 *     summary: Invite a staff member (emails a temp password)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [email], properties: { email: { type: string }, name: { type: string }, phone: { type: string }, roleId: { type: string } } } } }
 *     responses: { 201: { description: Invited }, 400: { description: Invalid role }, 409: { description: Email already exists } }
 * /agencies/me/staff/{id}:
 *   patch:
 *     tags: [Staff & Roles]
 *     summary: Update a staff member's profile (name / phone / email / role)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     requestBody:
 *       content: { application/json: { schema: { type: object, properties: { name: { type: string }, phone: { type: string }, email: { type: string }, roleId: { type: string, nullable: true } } } } }
 *     responses: { 200: { description: Updated }, 400: { description: Validation failed }, 404: { description: Not found }, 409: { description: Email in use } }
 *   delete:
 *     tags: [Staff & Roles]
 *     summary: Deactivate a staff member
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Deactivated }, 404: { description: Not found } }
 * /agencies/me/staff/{id}/role:
 *   patch:
 *     tags: [Staff & Roles]
 *     summary: Reassign a staff member's role
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [roleId], properties: { roleId: { type: string } } } } }
 *     responses: { 200: { description: Updated }, 404: { description: Role or staff not found } }
 * /agencies/me/staff/{id}/activity:
 *   get: { tags: [Staff & Roles], summary: Last 20 audit-log entries for a staff member, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Activity } } }
 * /agencies/me/staff/{id}/reactivate:
 *   patch:
 *     tags: [Staff & Roles]
 *     summary: Reactivate a previously deactivated staff member
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Reactivated }, 404: { description: Not found } }
 */

router.use(requireAuth);
// Instant revocation for an active impersonation session — see the
// middleware's own doc comment for why this can't just live inside
// requireAuth itself.
router.use(checkImpersonationActive);

// Maps to: POST /agencies/me/staff
router.post("/", requireRole(["AGENCY_ADMIN", "STAFF"]), requireStaffPermission("staff"), staffDelegationGuard, addStaff);

// Maps to: GET /agencies/me/staff
router.get("/", requireRole(["AGENCY_ADMIN", "STAFF"]), requireStaffPermission("staff"), staffDelegationGuard, listStaff);

// Maps to: PATCH /agencies/me/staff/:id/role
router.patch("/:id/role", requireRole(["AGENCY_ADMIN", "STAFF"]), requireStaffPermission("staff"), staffDelegationGuard, reassignRole);

// Maps to: PATCH /agencies/me/staff/:id  (full profile: name / phone / email / role)
router.patch("/:id", requireRole(["AGENCY_ADMIN", "STAFF"]), requireStaffPermission("staff"), staffDelegationGuard, updateStaff);

// Maps to: DELETE /agencies/me/staff/:id
router.delete("/:id", requireRole(["AGENCY_ADMIN", "STAFF"]), requireStaffPermission("staff"), staffDelegationGuard, deactivateStaff);

// Maps to: PATCH /agencies/me/staff/:id/reactivate
router.patch("/:id/reactivate", requireRole(["AGENCY_ADMIN", "STAFF"]), requireStaffPermission("staff"), staffDelegationGuard, reactivateStaff);

// Maps to: GET /agencies/me/staff/:id/activity
router.get("/:id/activity", requireRole(["AGENCY_ADMIN", "STAFF"]), requireStaffPermission("staff"), staffDelegationGuard, getStaffActivity);

export default router;