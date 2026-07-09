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

router.get(
  "/agencies/me/marketplace/impressions",
  authenticateWithRefreshToken,
  requireAgencyAuth,
  getAgencyMarketplacePerformance
);

// GET /agencies/me/marketplace/conversions?window_hours=24
router.get(
  "/agencies/me/marketplace/conversions",
  authenticateWithRefreshToken,
  requireAgencyAuth,
  getAgencyMarketplaceConversionsData
);

// Admin dashboards
router.get(
  "/admin/marketplace/top-agencies",
  requireSuperAdmin,
  getTopMarketplaceAgencies
);

export default router;