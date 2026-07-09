import express from "express";
import { agencyKYCSubmission, registerAgency, SubscriptionTiers, updateAgencyDomain, updateAgencyProfile } from "../controllers/agency.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
import { checkAgencyStatus, isPaidTier } from "src/middleware/agencyAccess.middleware";
import {
  getAgencyMarketplacePerformance,
  getAgencyMarketplaceConversionsData,
} from "../controllers/agencyAnalytics.controller";

import { upload } from "@funtush/storage";

const router = express.Router();

router.route("/register/agency")
  .post(registerAgency);

router.route("/agencies/me/kyc")
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

router.route("/agencies/me/domain")
  .patch(authenticateWithRefreshToken, isPaidTier, updateAgencyDomain);

router.route("/subscription-tiers")
  .get(SubscriptionTiers);

router.get(
  "/agencies/me/marketplace/impressions",
  authenticateWithRefreshToken,
  getAgencyMarketplacePerformance
);

router.get(
  "/agencies/me/marketplace/conversions",
  authenticateWithRefreshToken,
  getAgencyMarketplaceConversionsData
);

export default router;