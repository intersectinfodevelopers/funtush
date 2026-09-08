import { Router } from "express";
import { requireAuth, requireRole } from "@funtush/auth";
import {
  addStaff,
  listStaff,
  reassignRole,
  updateStaff,
  deactivateStaff,
  getStaffActivity,
} from "../controllers/staff.controller";

const router = Router();

/**
 * @openapi
 * /agencies/me/staff:
 *   get: { tags: [Staff & Roles], summary: List active staff members, security: [{ bearerAuth: [] }], responses: { 200: { description: Staff }, 401: { description: Unauthorized }, 403: { description: Forbidden } } }
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
 */

router.use(requireAuth);

// Maps to: POST /agencies/me/staff
router.post("/", requireRole(["AGENCY_ADMIN"]), addStaff);

// Maps to: GET /agencies/me/staff
router.get("/", requireRole(["AGENCY_ADMIN"]), listStaff);

// Maps to: PATCH /agencies/me/staff/:id/role
router.patch("/:id/role", requireRole(["AGENCY_ADMIN"]), reassignRole);

// Maps to: PATCH /agencies/me/staff/:id  (full profile: name / phone / email / role)
router.patch("/:id", requireRole(["AGENCY_ADMIN"]), updateStaff);

// Maps to: DELETE /agencies/me/staff/:id
router.delete("/:id", requireRole(["AGENCY_ADMIN"]), deactivateStaff);

// Maps to: GET /agencies/me/staff/:id/activity
router.get("/:id/activity", requireRole(["AGENCY_ADMIN"]), getStaffActivity);

export default router;