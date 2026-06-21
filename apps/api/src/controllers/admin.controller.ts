import type { Request, Response } from "express";
import { dismissFlagService, getFlaggedAgencyService, removeReviewWithContentViolation } from "src/services/admin.service";

export const getFlaggedAgency = async (
    req: Request,
    res: Response
) => {
    try {
        const result = await getFlaggedAgencyService();

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
};

export const removeReview = async (
    req: Request,
    res: Response
) => {
    try {
        const reviewId = req.params.id as string;

        const result = await removeReviewWithContentViolation(reviewId);

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Unknown error",
        });
    }
};



export const dismissReviewFlag = async (
    req: Request,
    res: Response
) => {
    try {
        const reviewId = req.params.id as string;

        const result = await dismissFlagService(reviewId);

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Unknown error",
        });
    }
};