import type { Request, Response } from "express";
import { createCouponService, getAgencyCouponsService, updateCouponService } from "src/services/coupon.service";

export const createCoupon = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyId = req.agencyId as string;

        const coupon = await createCouponService(
            agencyId,
            req.body
        );

        return res.status(201).json({
            success: true,
            data: coupon,
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const updateCoupon = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyId = req.agencyId as string;
        const couponId = req.params.id as string;

        const coupon = await updateCouponService(
            agencyId,
            couponId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: coupon,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const getAgencyCoupons = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyId = req.agencyId as string;

        const coupons = await getAgencyCouponsService(
            agencyId
        );

        return res.status(200).json({
            success: true,
            count: coupons.length,
            data: coupons,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};