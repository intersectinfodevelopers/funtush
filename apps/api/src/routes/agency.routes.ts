import express from "express";
import { getSubscriptionTiers, registerAcency, updateAgencyDomain, updateAgencyProfile, updateAgencySubscription } from "../controllers/agency.controller";
import { acceptBookings, getAgencyDashboard, publishPackages } from "../services/agency.service";
import { checkAgencyStatus } from "../middlewares/agencyAccess.middleware";

const router = express.Router();

router.route("/agencies/register")
    .get(registerAcency);

router.route("/subscription-tiers")
    .get(getSubscriptionTiers);

router.route("/bookings")
    .get(checkAgencyStatus, acceptBookings);

router.route("/packages")
    .get(checkAgencyStatus, publishPackages);

router.route("/dashboard")
    .get(getAgencyDashboard);

router.route("/agencies/me/subscribe")
    .get(updateAgencySubscription);

router.route("/agencies/me/profile")
    .patch(updateAgencyProfile);

router.route("/agencies/me/domain")
    .patch(updateAgencyDomain);

export default router;