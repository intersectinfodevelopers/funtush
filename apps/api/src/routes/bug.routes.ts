import { requireAuth, requireRole } from "@funtush/auth";

import { Router } from "express";
import { requireSuperAdminRole } from "../middleware/requireSuperAdminRole.middleware";
import {
  submitBugController,
  getAgencyBugsController,
  setBugPriorityController,
  assignBugController,
  addBugHintController,
  resolveBugController,
} from "../controllers/bugReport.controller";

const router = Router();

/**
 * Mounted twice in app.ts, same router: `/agencies/me/bugs` (submit/list —
 * `requireRole(["AGENCY_ADMIN"])`) and `/admin/bugs` (triage — all 4
 * priority/assign/hint/resolve routes require `requireSuperAdminRole`
 * regardless of which prefix reached them).
 *
 * @openapi
 * /agencies/me/bugs:
 *   post: { tags: [Bugs], summary: Submit a bug report, security: [{ bearerAuth: [] }], responses: { 201: { description: Submitted }, 400: { description: Missing required field } } }
 *   get: { tags: [Bugs], summary: List the agency's own bug reports, security: [{ bearerAuth: [] }], responses: { 200: { description: Reports } } }
 * /agencies/me/bugs/{id}/priority:
 *   patch: { tags: [Admin], summary: "Set a bug's priority (super admin — same route as /admin/bugs/{id}/priority, reachable under both prefixes)", security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 404: { description: Not found } } }
 * /agencies/me/bugs/{id}/assign:
 *   patch: { tags: [Admin], summary: "Assign a bug to a platform staff member (super admin — reachable under both prefixes)", security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Assigned } } }
 * /agencies/me/bugs/{id}/hint:
 *   post: { tags: [Admin], summary: "Add an internal triage note (super admin — reachable under both prefixes)", security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Added } } }
 * /agencies/me/bugs/{id}/resolve:
 *   patch: { tags: [Admin], summary: "Resolve a bug report (super admin — reachable under both prefixes)", security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Resolved }, 409: { description: Already resolved } } }
 * /admin/bugs:
 *   post: { tags: [Admin], summary: "Submit a bug report (same route as /agencies/me/bugs, reachable under both prefixes)", security: [{ bearerAuth: [] }], responses: { 201: { description: Submitted }, 400: { description: Missing required field } } }
 *   get: { tags: [Admin], summary: "List bug reports (same route as /agencies/me/bugs, reachable under both prefixes)", security: [{ bearerAuth: [] }], responses: { 200: { description: Reports } } }
 * /admin/bugs/{id}/priority:
 *   patch: { tags: [Admin], summary: Set a bug's priority (super admin), security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 404: { description: Not found } } }
 * /admin/bugs/{id}/assign:
 *   patch: { tags: [Admin], summary: Assign a bug to a platform staff member (super admin), security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Assigned } } }
 * /admin/bugs/{id}/hint:
 *   post: { tags: [Admin], summary: Add an internal triage note (super admin), security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Added } } }
 * /admin/bugs/{id}/resolve:
 *   patch: { tags: [Admin], summary: Resolve a bug report (super admin), security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Resolved }, 409: { description: Already resolved } } }
 */
router.post("/", requireAuth, requireRole(["AGENCY_ADMIN"]), submitBugController);
// GET "/" previously allowed only AGENCY_ADMIN — meaning GET /admin/bugs,
// the list this router's own header comment describes as reachable for
// triage, 403'd for every real platform-admin caller (confirmed against a
// real SUPER_ADMIN JWT while wiring up the admin panel's Bug Triage page).
// The 4 triage sub-routes were already SUPER_ADMIN-reachable; this makes
// the list consistent with them.
router.get("/", requireAuth, requireRole(["AGENCY_ADMIN", "SUPER_ADMIN", "PLATFORM_ADMIN"]), getAgencyBugsController);

router.patch("/:id/priority", requireAuth, requireSuperAdminRole, setBugPriorityController);
router.patch("/:id/assign", requireAuth, requireSuperAdminRole, assignBugController);
router.post("/:id/hint", requireAuth, requireSuperAdminRole, addBugHintController);
router.patch("/:id/resolve", requireAuth, requireSuperAdminRole, resolveBugController);

export default router;