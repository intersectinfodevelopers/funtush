import type { Request, Response } from "express";
import {
    getAgencyMarketplaceImpressions,
    getAgencyMarketplaceConversions,
    getTopAgenciesByImpressions,
} from "../services/marketplaceAnalytics.service.js";

/**
 * Middleware: verify request is from authenticated agency.
 * Assumes req.agency is set by auth middleware.
 */
function requireAgencyAuth(req: Request, res: Response, next: () => void) {
    if (!req.agencyId) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized. Agency authentication required.",
        });
    }
    next();
}

/**
 * GET /agencies/me/marketplace/impressions?period=last_30_days
 * 
 * Returns: daily impression/click/conversion breakdown + aggregated CTR
 * Query params: period (last_7_days | last_30_days | last_90_days, default: last_30_days)
 */
export const getAgencyMarketplacePerformance = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId!;
        const period = (req.query.period as string) || "last_30_days";

        // Validate period
        if (!["last_7_days", "last_30_days", "last_90_days"].includes(period)) {
            return res.status(400).json({
                success: false,
                message: "Invalid period. Allowed: last_7_days, last_30_days, last_90_days",
            });
        }

        const data = await getAgencyMarketplaceImpressions(
            agencyId,
            period as "last_7_days" | "last_30_days" | "last_90_days"
        );

        return res.json({
            success: true,
            data,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch marketplace performance";
        return res.status(500).json({ success: false, message });
    }
};

/**
 * GET /agencies/me/marketplace/conversions
 * 
 * Returns: list of clicks that converted to bookings within 24h window
 * Shows conversion chain: click → inquiry → booking
 */
export const getAgencyMarketplaceConversionsData = async (req: Request, res: Response) => {
    try {
        const agencyId = req.agencyId!;
        const windowHours = req.query.window_hours ? parseInt(req.query.window_hours as string) : 24;

        if (!Number.isFinite(windowHours) || windowHours < 1 || windowHours > 168) {
            return res.status(400).json({
                success: false,
                message: "Invalid window_hours. Must be between 1 and 168 (7 days)",
            });
        }

        const data = await getAgencyMarketplaceConversions(agencyId, windowHours);

        return res.json({
            success: true,
            data,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch marketplace conversions";
        return res.status(500).json({ success: false, message });
    }
};

/**
 * ADMIN ONLY: GET /admin/marketplace/top-agencies?period=last_30_days&limit=10
 * 
 * Returns: ranked list of agencies by impression count
 * Used for: admin dashboards, featured content curation, performance insights
 */
export const getTopMarketplaceAgencies = async (req: Request, res: Response) => {
    try {
        // Verify requester is super-admin (adjust based on your auth structure)
        if (req.user?.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Forbidden. Super admin access required.",
            });
        }

        const period = (req.query.period as string) || "last_7_days";
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

        if (!["last_7_days", "last_30_days"].includes(period)) {
            return res.status(400).json({
                success: false,
                message: "Invalid period. Allowed: last_7_days, last_30_days",
            });
        }

        if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({
                success: false,
                message: "Invalid limit. Must be between 1 and 100",
            });
        }

        const data = await getTopAgenciesByImpressions(
            period as "last_7_days" | "last_30_days",
            limit
        );

        return res.json({
            success: true,
            data,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch top agencies";
        return res.status(500).json({ success: false, message });
    }
};

export { requireAgencyAuth };