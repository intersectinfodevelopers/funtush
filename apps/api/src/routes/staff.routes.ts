import { Router } from "express";
import { requireAuth, requireRole } from "@funtush/auth";
import {
  addStaff,
  listStaff,
  reassignRole,
  deactivateStaff,
  getStaffActivity,
} from "../controllers/staff.controller";

const router = Router();

router.use(requireAuth);

// Maps to: POST /agencies/me/staff
router.post("/", requireRole(["AGENCY_ADMIN"]), addStaff);

// Maps to: GET /agencies/me/staff
router.get("/", requireRole(["AGENCY_ADMIN"]), listStaff);

// Maps to: PATCH /agencies/me/staff/:id/role
router.patch("/:id/role", requireRole(["AGENCY_ADMIN"]), reassignRole);

// Maps to: DELETE /agencies/me/staff/:id
router.delete("/:id", requireRole(["AGENCY_ADMIN"]), deactivateStaff);

// Maps to: GET /agencies/me/staff/:id/activity
router.get("/:id/activity", requireRole(["AGENCY_ADMIN"]), getStaffActivity);

export default router;