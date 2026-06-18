import { uploadFile } from "@funtush/storage";
import type { Request, Response } from "express";
import { createReviewService } from "src/services/review.service";

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