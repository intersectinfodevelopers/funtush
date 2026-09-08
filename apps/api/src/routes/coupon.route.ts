import { Router } from "express";
import { applyCoupon, createCoupon, getAgencyCoupons, updateCoupon } from "src/controllers/coupon.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
const router = Router();

/**
 * @openapi
 * /agencies/me/coupons:
 *   get: { tags: [Coupons], summary: List the agency's coupons, security: [{ refreshToken: [] }], responses: { 200: { description: Coupons }, 401: { description: Unauthorized } } }
 *   post: { tags: [Coupons], summary: Create a coupon, security: [{ refreshToken: [] }], responses: { 201: { description: Created }, 400: { description: Validation failed } } }
 * /agencies/me/coupons/{id}:
 *   patch: { tags: [Coupons], summary: Update a coupon, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 * /bookings/inquiry/apply-coupon:
 *   patch: { tags: [Coupons], summary: "Public: validate + apply a coupon code to an inquiry", responses: { 200: { description: Discount applied }, 400: { description: Invalid / expired } } }
 */
router.route('/agencies/me/coupons')
    .get(authenticateWithRefreshToken, getAgencyCoupons)
    .post(authenticateWithRefreshToken, createCoupon);

router.route('/agencies/me/coupons/:id')
    .patch(authenticateWithRefreshToken, updateCoupon);

router.route('/bookings/inquiry/apply-coupon')
    .patch(applyCoupon);

export default router;