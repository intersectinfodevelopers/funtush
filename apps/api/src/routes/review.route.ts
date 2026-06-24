import { upload } from "@funtush/storage";
import { Router } from "express";
import { dismissReviewFlag, getFlaggedAgency, removeReview } from "src/controllers/review.controller";
import { createReview, flagReview, getReviews, reviewResponse } from "src/controllers/review.controller";
// import { requireAdmin } from "src/middleware/requireAdmin.middleware";

const router = Router();

router.route('/reviews')
    .post(upload.array("photos", 10), createReview);

router.route('/agencies/:slug/reviews')
    .get(getReviews);

router.route('/agencies/:id/response')
    .post(reviewResponse);

router.route('/agencies/:id/flag')
    .post(flagReview);
    
router.route("/admin/reviews/flagged")
    .get( getFlaggedAgency);

router.route("/admin/reviews/:id/remove")
    .patch( removeReview);

router.route("/admin/reviews/:id/dismiss-flag")
    .patch( dismissReviewFlag);
 
export default router;