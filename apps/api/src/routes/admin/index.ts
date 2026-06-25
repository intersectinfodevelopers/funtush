import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.middleware.js";
import dashboardRouter from "./dashboard.route.js";
import agencyManagementRouter from "./agencyManagement.route.js";
import adCampaignsRouter from "./adCampaigns.route.js";

const router = Router();

// All admin routes require admin auth
router.use(requireAdmin);

router.use("/dashboard", dashboardRouter);
router.use("/agencies", agencyManagementRouter);
router.use("/ad-campaigns", adCampaignsRouter);

export default router;