import express from "express";
import { db } from "@funtush/database";
import { PERMISSION_KEYS } from "../config/permissionCatalog";
import { loadStaffAccess } from "../services/staffAccess.service";
import { agencyKYCStatus, agencyKYCSubmission, getAgencyDashboard, registerAgency, SubscriptionTiers, updateAgencyProfile, getAgencyProfile, verifyAgencyRegistrationOtpController } from "../controllers/agency.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "src/middleware/agencyAccess.middleware";

import { upload } from "@funtush/storage";

const router = express.Router();

router.route("/register/agency")
  .post(registerAgency);

/**
 * @openapi
 * /register/agency/verify-otp:
 *   post:
 *     tags: [Agency]
 *     summary: Verify the phone OTP sent by POST /register/agency (only when the admin-controlled agencyPhoneOtpRequired setting is on) and complete registration
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [sessionToken, otp], properties: { sessionToken: { type: string }, otp: { type: string, minLength: 6, maxLength: 6 } } }
 *     responses:
 *       201: { description: Agency registered }
 *       400: { description: sessionToken/otp missing, expired, or incorrect }
 *       409: { description: Email already registered by someone else during the OTP window }
 */
router.route("/register/agency/verify-otp")
  .post(verifyAgencyRegistrationOtpController);

router.route("/agencies/me/kyc")
  .get(authenticateWithRefreshToken, agencyKYCStatus)
  .post(authenticateWithRefreshToken,
    upload.fields([
      { name: "business_registration", maxCount: 1 },
      { name: "pan_certificate", maxCount: 1 },
      { name: "tourism_license", maxCount: 1 },
      { name: "bank_details", maxCount: 1 },
    ]),
    agencyKYCSubmission);

// Documented in openapi.ts and implemented in the controller, but never mounted —
// GET /agencies/me/dashboard used to 404.
// What the signed-in agency user may see: the owner gets everything; staff get their role's permissions. The
// dashboard uses it to hide what a staff member can't open (the API enforces it regardless).
router.get("/agencies/me/access", authenticateWithRefreshToken, async (req, res) => {
  try {
    const au = await db.agencyUser.findFirst({ where: { id: req.tenantId as string }, select: { id: true, role: true } });
    if (!au) return void res.status(401).json({ success: false, message: "Unauthorized" });
    if (au.role === "AGENCY_ADMIN") return void res.json({ success: true, data: { role: "AGENCY_ADMIN", admin: true, permissions: [...PERMISSION_KEYS] } });
    const access = await loadStaffAccess(au.id, req.agencyId as string);
    res.json({ success: true, data: { role: "STAFF", admin: false, permissions: [...access.permissions] } });
  } catch (err) {
    console.error("[access]", err);
    res.status(500).json({ success: false, message: "Failed to load access" });
  }
});

router.route("/agencies/me/dashboard")
  .get(authenticateWithRefreshToken, getAgencyDashboard);

router.route("/agencies/me/profile")
  .get(authenticateWithRefreshToken, getAgencyProfile)
  .patch(authenticateWithRefreshToken, checkAgencyStatus, updateAgencyProfile);

// /agencies/me/domain (+ /verify, /publish, /unpublish) now live in
// domain.routes.ts — see that file's header for why the paid-tier gate
// differs between connect/verify/disconnect and publish/unpublish.

router.route("/subscription-tiers")
  .get(SubscriptionTiers);

// NOTE: GET /agencies/me/marketplace/{impressions,conversions} live in
// agencyAnalytics.routes.ts — declaring them here too caused a duplicate route.

export default router;