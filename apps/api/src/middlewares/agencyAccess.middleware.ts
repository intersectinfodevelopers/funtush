import type { Response, NextFunction } from "express";
import type { AgencyRequest } from "../types/auth-request";


export const checkAgencyStatus = (req: AgencyRequest, res: Response, next: NextFunction) => {
    // From auth middleware
    const agency = req.agencyUser;

    if (!agency) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }

    if (agency.status === "LOCKED") {
        return res.status(403).json({
            success: false,
            message: "Account is locked. Please upgrade subscription for usage.",
        });
    }

    next();
};


export const isPaidTier = (req: AgencyRequest, res: Response, next: NextFunction) => {

    const agency = req.agencyUser;

    if (!agency) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }

    if (agency.tier === "FREE") {
        return res.status(403).json({
            success: false,
            message: "Custom domains are for the paid tiers. Please upgrade subscription.",
        });
    }

    next();
};
