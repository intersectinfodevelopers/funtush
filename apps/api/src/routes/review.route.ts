import { upload } from "@funtush/storage";
import { Router } from "express";
import { dismissReviewFlag, getFlaggedAgency, removeReview } from "src/controllers/review.controller";
import { createReview, flagReview, getReviews, reviewResponse } from "src/controllers/review.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
import { requireAdmin } from "src/middleware/requireAdmin.middleware";

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
 * /admin/reviews/flagged:
 *   get: { tags: [Admin], summary: Agencies with flagged reviews awaiting moderation, security: [{ bearerAuth: [] }], responses: { 200: { description: Flagged queue } } }
 * /admin/reviews/{id}/remove:
 *   patch: { tags: [Admin], summary: Remove a review for a content violation, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Removed } } }
 * /admin/reviews/{id}/dismiss-flag:
 *   patch: { tags: [Admin], summary: Dismiss a review's moderation flag, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Dismissed } } }
 */
router.route('/reviews')
    .post(upload.array("photos", 10), createReview);

router.route('/agencies/:slug/reviews')
    .get(getReviews);

router.route('/reviews/:id/response')
    .post(authenticateWithRefreshToken, reviewResponse);

router.route('/reviews/:id/flag')
    .post(authenticateWithRefreshToken, flagReview);

/**
 * These 3 routes had **no auth middleware and no in-controller check at
 * all** — mounted directly at `/` (`app.ts`), they never pass through
 * `admin/index.ts`'s `router.use(requireAdmin)` the way every other
 * `/admin/*` route does. Anyone could remove any review or dismiss any
 * moderation flag with no credentials whatsoever. `requireAdmin` added to
 * match the gate every other admin route already has.
 */
router.route("/admin/reviews/flagged")
    .get(requireAdmin, getFlaggedAgency);

router.route("/admin/reviews/:id/remove")
    .patch(requireAdmin, removeReview);

router.route("/admin/reviews/:id/dismiss-flag")
    .patch(requireAdmin, dismissReviewFlag);

export default router;