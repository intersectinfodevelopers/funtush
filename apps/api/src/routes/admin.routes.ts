import express from "express";
import { dismissReviewFlag, getFlaggedAgency, removeReview } from "src/controllers/admin.controller";
import { requireAdmin } from "src/middleware/requireAdmin.middleware";
// import { approveAgencyKYC, rejectAgencyKYC } from "../controllers/agency.adminController.js";


const router = express.Router();

// router.route("/admin/agencies/:id/kyc/approve")
//     .patch(approveAgencyKYC);

// router.route("/admin/agencies/:id/kyc/reject")
//     .patch(rejectAgencyKYC);

router.route("/admin/reviews/flagged")
    .get(getFlaggedAgency);

router.route("/admin/reviews/:id/remove")
    .patch(requireAdmin, removeReview);

router.route("/admin/reviews/:id/dismiss-flag")
    .patch(requireAdmin, dismissReviewFlag);

export default router;