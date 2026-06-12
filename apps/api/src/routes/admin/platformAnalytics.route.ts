import { Router } from "express";
import type { Request, Response } from "express";
import {
  getPlatformOverview,
  getAgencyPerformance,
  getMarketplaceAnalytics,
  getTierAnalytics,
} from "../../services/platformAnalytics.service";

const router = Router();

/**
 * GET /admin/analytics
 * Platform-wide overview: total bookings, revenue by tier, top destinations
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await getPlatformOverview();
    res.json(data);
  } catch (err: unknown) {
    console.error("[GET /admin/analytics]", err);
    res.status(500).json({ error: "Failed to load platform analytics" });
  }
});

/**
 * GET /admin/analytics/agencies
 * Top performing agencies by bookings, revenue, and retention
 */
router.get("/agencies", async (_req: Request, res: Response) => {
  try {
    const data = await getAgencyPerformance();
    res.json(data);
  } catch (err: unknown) {
    console.error("[GET /admin/analytics/agencies]", err);
    res.status(500).json({ error: "Failed to load agency performance analytics" });
  }
});

/**
 * GET /admin/analytics/marketplace
 * Most searched destinations, popular filters, conversion funnel
 */
router.get("/marketplace", async (_req: Request, res: Response) => {
  try {
    const data = await getMarketplaceAnalytics();
    res.json(data);
  } catch (err: unknown) {
    console.error("[GET /admin/analytics/marketplace]", err);
    res.status(500).json({ error: "Failed to load marketplace analytics" });
  }
});

/**
 * GET /admin/analytics/tiers
 * Trial to paid conversion rate, churn rate per tier
 */
router.get("/tiers", async (_req: Request, res: Response) => {
  try {
    const data = await getTierAnalytics();
    res.json(data);
  } catch (err: unknown) {
    console.error("[GET /admin/analytics/tiers]", err);
    res.status(500).json({ error: "Failed to load tier analytics" });
  }
});

export default router;
