import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.middleware.js";
import dashboardRouter from "./dashboard.route.js";
import agencyManagementRouter from "./agencyManagement.route";

const router = Router();

router.use(requireAdmin);

router.use("/dashboard", dashboardRouter);
router.use("/agencies", agencyManagementRouter);

export default router;