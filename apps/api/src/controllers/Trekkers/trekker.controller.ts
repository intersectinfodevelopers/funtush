import type { Request, Response } from "express";
import { db } from "@funtush/database";
import { createTrekker, trekkerPreferenceService } from "src/services/trekker.service.js";

export const registerTrekker= async(req:Request , res: Response) => {
    try {
        const trekker = await createTrekker(req.body);
        res.status(201).json({
            status: "success",
            data: trekker
        });
    } catch (err) {
        // `createTrekker` throws with a real `.status` (409 for a duplicate
        // email) — previously ignored here, so every failure reported 500.
        const status = (err as { status?: number })?.status ?? 500;
        res.status(status).json({
            status: "error",
            message: err instanceof Error ? err.message : "Registration failed"
        });
    }
}


export const trekkerPreference = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ status: "error", message: "Unauthorized" });
        }

        // The trekker whose preferences this is is the *session's own*
        // trekker record — never a client-supplied id, which would let any
        // signed-in caller overwrite an arbitrary other trekker's
        // preferences (an IDOR this endpoint previously had no defense
        // against at all, on top of having no auth to begin with).
        const trekker = await db.trekker.findUnique({ where: { userId }, select: { id: true } });
        if (!trekker) {
            return res.status(404).json({ status: "error", message: "Trekker profile not found" });
        }

        const preference = await trekkerPreferenceService(trekker.id, req.body);
        res.status(200).json({
            status: "success",
            data: preference
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err
        });
    }
}
