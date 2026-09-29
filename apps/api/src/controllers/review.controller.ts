import { uploadFile } from "@funtush/storage";
import type { Request, Response } from "express";
import { parsePagination } from "../utils/pagination";
import { assertReviewTokenUsable, createReviewService, flagReviewService, validateReviewInput, getAgencyReview, respondToReviewService, deleteAgencyReviewService } from "src/services/review.service";
import { countFlaggedReviews, dismissFlagService, getFlaggedAgencyService, removeReviewWithContentViolation } from "src/services/review.service";
import { buildMeta } from "../utils/pagination";


export const createReview = async (
    req: Request,
    res: Response
) => {
    try {
        const { token, rating, text, title } = req.body;
        if (typeof token !== "string" || !token) {
            return res.status(400).json({ success: false, message: "A valid review token is required" });
        }

        // multipart fields arrive as strings
        const ratingNum = Number(rating);
        validateReviewInput(ratingNum, text, title);
        await assertReviewTokenUsable(token);

        const photos = (req.files as Express.Multer.File[]) || [];
        if (photos.length > 5) {
            return res.status(400).json({ success: false, message: "You can attach up to 5 photos." });
        }

        const urls = await Promise.all(
            photos.map((photo) => uploadFile(photo))
        );

        const review = await createReviewService(
            token,
            ratingNum,
            text,
            urls || [],
            title
        );

        return res.status(201).json({
            success: true,
            data: review,
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Failed to submit review",
        });
    }
};

export const getReviews = async (
    req: Request,
    res: Response
) => {
    try {
        const { slug } = req.params;

        if (typeof slug !== "string") {
            return res.status(400).json({
                success: false,
                message: "Invalid slug",
            });
        }

        const q = req.query;
        const rating = typeof q.rating === "string" ? Number(q.rating) : undefined;
        const filters = {
            rating: rating && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
            responded: q.responded === "true" ? true : q.responded === "false" ? false : undefined,
            sort: (["newest", "oldest", "lowest", "highest"] as const).find((s) => s === q.sort),
        };
        const reviews = await getAgencyReview(slug, parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 }), filters);

        return res.status(200).json({
            success: true,
            data: reviews,
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Failed to load reviews",
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
            message: err instanceof Error ? err.message : "Failed to respond to review",
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

    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Failed to flag review",
        });
    }
};

export const deleteReview = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const reviewId = req.params.id as string;

        const result = await deleteAgencyReviewService(agencyUserId, reviewId);

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : "Failed to delete review",
        });
    }
};

export const getFlaggedAgency = async (
    req: Request,
    res: Response
) => {
    try {
        const page = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
        // Default: the PENDING moderation queue. ?status=all includes dismissed history.
        const filter = req.query.status === "all" ? {} : { status: "PENDING" as const };
        const [result, total] = await Promise.all([
            getFlaggedAgencyService({ skip: page.skip, take: page.take }, filter),
            countFlaggedReviews(filter),
        ]);

        return res.status(200).json({
            success: true,
            data: { ...result, meta: buildMeta(total, page.page, page.limit) },
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load flagged reviews",
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

