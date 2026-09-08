import { upload } from "@funtush/storage";
import { Router } from "express";
import { dismissReviewFlag, getFlaggedAgency, removeReview } from "src/controllers/review.controller";
import { createReview, flagReview, getReviews, reviewResponse } from "src/controllers/review.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

/**
 * @openapi
 * /reviews:
 *   post: { tags: [Reviews], summary: "Public: submit a review (multipart, up to 10 photos)", responses: { 201: { description: Created } } }
 * /agencies/{slug}/reviews:
 *   get: { tags: [Reviews], summary: "Public: reviews for an agency", parameters: [{ name: slug, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Reviews } } }
 * /reviews/{id}/response:
 *   post: { tags: [Reviews], summary: Agency responds to a review, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Response posted } } }
 * /reviews/{id}/flag:
 *   post: { tags: [Reviews], summary: Agency flags a review for moderation, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 201: { description: Flagged } } }
 */
router.route('/reviews')
    .post(upload.array("photos", 10), createReview);

router.route('/agencies/:slug/reviews')
    .get(getReviews);

router.route('/reviews/:id/response')
    .post(authenticateWithRefreshToken, reviewResponse);

router.route('/reviews/:id/flag')
    .post(authenticateWithRefreshToken, flagReview);

router.route("/admin/reviews/flagged")
    .get(getFlaggedAgency);

router.route("/admin/reviews/:id/remove")
    .patch(removeReview);

router.route("/admin/reviews/:id/dismiss-flag")
    .patch(dismissReviewFlag);

export default router;