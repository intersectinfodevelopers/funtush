import { Router } from "express";
import { createCoupon, getAgencyCoupons, updateCoupon } from "src/controllers/coupon.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
const router = Router();

router.route('/agencies/me/coupons')
    .get(authenticateWithRefreshToken, getAgencyCoupons)
    .post(createCoupon);

router.route('/agencies/me/coupons/:id')
    .patch(updateCoupon);

export default router;