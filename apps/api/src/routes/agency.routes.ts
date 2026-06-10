import express from "express";
import { agencyKYCSubmission, getAgencyDashboard, registerAcency, updateAgencyDomain, updateAgencyProfile, updateAgencySubscription } from "../controllers/agency.controller.js";
import { checkAgencyStatus } from "../middlewares/agencyAccess.middleware.js";
import { acceptBooking, agencyKYCStatus, SubscriptionTiers, publishPackage } from "../controllers/agency.controller.js";
import { authenticateWithRefreshToken } from "../middlewares/refreshTokenAuthentication.js";
import { upload } from "@funtush/storage";
import { registerAcency } from "../controllers/agency.controller";

const router = express.Router();

router.route("/register")
  .get(registerAcency);


export default router;