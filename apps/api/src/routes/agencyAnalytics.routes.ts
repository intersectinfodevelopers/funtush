import express, { type Request, type Response, type NextFunction } from "express";
import { verifyAccessToken } from "@funtush/auth";
import {
  getAgencyMarketplacePerformance,
  getAgencyMarketplaceConversionsData,
  getTopMarketplaceAgencies,
  requireAgencyAuth,
} from "../controllers/agencyAnalytics.controller.js";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";

const router = express.Router();

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    if (payload.role !== "SUPER_ADMIN" || payload.roleType !== "PLATFORM") {
      res.status(403).json({ success: false, message: "Forbidden. Super admin access required." });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

/**
 * @openapi
 * /agencies/me/marketplace/impressions:
 *   get:
 *     tags: [Analytics]
 *     summary: Daily marketplace impression/click/conversion breakdown and aggregated CTR
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: period, in: query, schema: { type: string, enum: [last_7_days, last_30_days, last_90_days] } }
 *     responses: { 200: { description: Performance }, 400: { description: Invalid period } }
 */
router.get(
  "/agencies/me/marketplace/impressions",
  authenticateWithRefreshToken,
  requireAgencyAuth,
  getAgencyMarketplacePerformance
);

/**
 * @openapi
 * /agencies/me/marketplace/conversions:
 *   get:
 *     tags: [Analytics]
 *     summary: Marketplace clicks that converted to a booking within a time window (click → inquiry → booking)
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: window_hours, in: query, schema: { type: integer, minimum: 1, maximum: 168 }, description: "Default 24" }
 *     responses: { 200: { description: Conversions }, 400: { description: Invalid window_hours } }
 */
router.get(
  "/agencies/me/marketplace/conversions",
  authenticateWithRefreshToken,
  requireAgencyAuth,
  getAgencyMarketplaceConversionsData
);

/**
 * @openapi
 * /admin/marketplace/top-agencies:
 *   get:
 *     tags: [Admin]
 *     summary: Top agencies by marketplace impressions (super admin only — platform-admin JWT)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Ranking }, 401: { description: Unauthorized }, 403: { description: Not a super admin } }
 */
router.get(
  "/admin/marketplace/top-agencies",
  requireSuperAdmin,
  getTopMarketplaceAgencies
);

export default router;