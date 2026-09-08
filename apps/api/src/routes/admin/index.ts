import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.middleware.js";
import dashboardRouter from "./dashboard.route.js";
import agencyManagementRouter from "./agencyManagement.route.js";
import adCampaignsRouter from "./adCampaigns.route.js";
import fraudRouter from "./fraud.route.js";
import platformAnalyticsRouter from "./platformAnalytics.route.js";
import sosMonitoringRouter from "./sosMonitoring.route.js";
import safetyWarningRouter from "./safetyWarning.route.js";
import kycRouter from "./kyc.route.js";
import emailQueueRouter from "./emailQueue.route.js";
import tiersRouter from "./tiers.route.js";

const router = Router();

// All admin routes require admin auth
router.use(requireAdmin);

router.use("/dashboard", dashboardRouter);
router.use("/agencies", agencyManagementRouter);
router.use("/ad-campaigns", adCampaignsRouter);
router.use("/fraud", fraudRouter);
router.use("/analytics", platformAnalyticsRouter);
router.use("/sos", sosMonitoringRouter);
router.use("/safety-warnings", safetyWarningRouter);
router.use("/kyc", kycRouter);
router.use("/email-queue", emailQueueRouter);
router.use("/tiers", tiersRouter);

export default router;
