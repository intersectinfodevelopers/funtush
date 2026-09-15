import express from "express";
import { agencyKYCStatus, agencyKYCSubmission, registerAgency, SubscriptionTiers, updateAgencyProfile } from "../controllers/agency.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
import { checkAgencyStatus } from "src/middleware/agencyAccess.middleware";

import { upload } from "@funtush/storage";

const router = express.Router();

router.route("/register/agency")
  .post(registerAgency);

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

router.route("/agencies/me/profile")
  .patch(authenticateWithRefreshToken, checkAgencyStatus, updateAgencyProfile);

// /agencies/me/domain (+ /verify, /publish, /unpublish) now live in
// domain.routes.ts — see that file's header for why the paid-tier gate
// differs between connect/verify/disconnect and publish/unpublish.

router.route("/subscription-tiers")
  .get(SubscriptionTiers);

// NOTE: GET /agencies/me/marketplace/{impressions,conversions} live in
// agencyAnalytics.routes.ts — declaring them here too caused a duplicate route.

export default router;