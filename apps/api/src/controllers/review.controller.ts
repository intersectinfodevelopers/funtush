import { uploadFile } from "@funtush/storage";
import type { Request, Response } from "express";
import { createReviewService, flagReviewService, getAgencyReview, respondToReviewService } from "src/services/review.service";
import { dismissFlagService, getFlaggedAgencyService, removeReviewWithContentViolation } from "src/services/review.service";


export const createReview = async (
    req: Request,
    res: Response
) => {
    try {
        const { token, rating, text } = req.body;

        const photos = (req.files as Express.Multer.File[]) || [];

        const urls = await Promise.all(
            photos.map((photo) => uploadFile(photo))
        );

        const review = await createReviewService(
            token,
            Number(rating),
            text,
            urls || []
        );

        return res.status(201).json({
            success: true,
            data: review,
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err,
        });
    }
};

export const getReviews = async (
    req: Request,
    res: Response
) => {
    try {
        // const slug = req.params.slug as string;

        const { slug } = req.params;

        if (typeof slug !== "string") {
            return res.status(400).json({
                success: false,
                message: "Invalid slug",
            });
        }

        const reviews = await getAgencyReview(slug);

        return res.status(200).json({
            success: true,
            data: reviews,
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err,
        });
    }
};

export const reviewResponse = async (
    req: Request,
    res: Response
) => {
    try {

        const agencyUserId = req.tenantId as string;
        const reviewId = req.params.id as string;
        const { responseText } = req.body;


        const response = await respondToReviewService(
            agencyUserId, reviewId, responseText
        );

        return res.status(201).json({
            success: true,
            data: response,
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err,
        });
    }
};

export const flagReview = async (
    req: Request,
    res: Response
) => {
    try {

        const agencyUserId = req.tenantId as string;
        const reviewId = req.params.id as string;
        const { reason } = req.body;


        const flaggedReview = await flagReviewService(
            agencyUserId, reviewId, reason
        );

        return res.status(201).json({
            success: true,
            data: flaggedReview,
        });

    } catch (err: any) {
        return res.status(400).json({
            success: false,
            message: err.message,
        });
    }
};

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

