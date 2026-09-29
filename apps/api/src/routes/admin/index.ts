import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.middleware.js";
import { attributeAdmin } from "../../middleware/attributeAdmin.middleware.js";
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
import platformSettingsRouter from "./platformSettings.route.js";
import auditLogsRouter from "./auditLogs.route.js";
import staffRouter from "./staff.route.js";
import meRouter from "./me.route.js";
import tierDiscountsRouter from "./tierDiscounts.route.js";

const router = Router();

// All admin routes require admin auth
router.use(requireAdmin);
router.use(attributeAdmin); // audit-log actor for IP-gated routes (never rejects)

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
router.use("/settings", platformSettingsRouter);
router.use("/audit-logs", auditLogsRouter);
router.use("/staff", staffRouter);
router.use("/me", meRouter);
router.use("/tier-discounts", tierDiscountsRouter);

export default router;
