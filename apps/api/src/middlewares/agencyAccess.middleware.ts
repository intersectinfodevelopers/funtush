import type { Response, NextFunction } from "express";
import type { AgencyRequest } from "../types/auth-request";
import { db } from "@funtush/database";


export const checkAgencyStatus = async (req: AgencyRequest, res: Response, next: NextFunction) => {
    // From auth middleware

    const agencyId = req.agencyUser?.agencyId;

    if (!agencyId) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }


    const agency = await db.agency.findUnique({
        where: {
            id: agencyId,
        },
        select: {
            status: true,
        },
    });

    if (!agency) {
        return res.status(404).json({
            success: false,
            message: "Agency not found",
        });
    }

    if (agency?.status !== "ACTIVE") {
        return res.status(403).json({
            success: false,
            message: "Your subscription is expired. Account is locked. Please upgrade subscription for usage.",
        });
    }

    next();
};


export const isPaidTier = async (req: AgencyRequest, res: Response, next: NextFunction) => {

    const agencyId = req.agencyUser?.agencyId;

    if (!agencyId) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyId,
        },
        select: {
            tier: {
                select: {
                    name: true, //Agency → SubscriptionTier → name
                },
            },
        },
    });

    if (!agency) {
        return res.status(404).json({
            success: false,
            message: "Agency not found",
        });
    }

    if (agency.tier?.name === "FREE") {
        return res.status(403).json({
            success: false,
            message: "Custom domains are for the paid tiers. Please upgrade subscription.",
        });
    }

    next();
};
