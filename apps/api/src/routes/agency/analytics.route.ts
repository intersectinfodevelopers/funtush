import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@funtush/database";
import {
  resolveDateRange,
  getOverviewAnalytics,
  getPackageAnalytics,
  getCustomerAnalytics,
  getGuideAnalytics,
  type Period,
} from "../../services/agencyAnalytics.service";

const router = Router();

const FREE_PERIODS: Period[] = ["last_7_days", "last_30_days"];
const PAID_PERIODS: Period[] = ["last_7_days", "last_30_days", "last_12_months", "custom"];

/**
 * `req.tier` was read here but never set by any middleware anywhere in the
 * app — every request fell through to `undefined`, so `parsePeriodFromQuery`
 * always used `FREE_PERIODS` regardless of the agency's real tier. Every
 * MEDIUM/LARGE agency was silently denied `last_12_months`/`custom`, a
 * feature it's actually paying for. Resolved from the DB instead. (Also
 * drops the "ENTERPRISE" tier check — there is no such tier in this
 * backend's 4-tier system, FREE/SMALL/MEDIUM/LARGE.)
 */
async function resolveAgencyTier(agencyId: string): Promise<string | undefined> {
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { tier: { select: { name: true } } } });
  return agency?.tier?.name;
}

function parsePeriodFromQuery(
  query: Record<string, string | undefined>,
  tier?: string
): { period: Period; from?: string; to?: string; error?: string } {
  const period = (query.period as Period) ?? "last_30_days";
  const from   = query.from;
  const to     = query.to;

  const allowedPeriods = (tier === "MEDIUM" || tier === "LARGE")
    ? PAID_PERIODS
    : FREE_PERIODS;

  if (!allowedPeriods.includes(period)) {
    return {
      period,
      error: `Period '${period}' requires a paid tier. Available: ${allowedPeriods.join(", ")}`,
    };
  }
  if (period === "custom" && (!from || !to)) {
    return { period, error: "custom period requires from and to query params (YYYY-MM-DD)" };
  }
  return { period, from, to };
}

/**
 * @openapi
 * /agencies/me/analytics:
 *   get:
 *     tags: [Analytics]
 *     summary: Booking/revenue overview analytics (FREE/SMALL get 7/30-day windows; MEDIUM/LARGE also get 12-month and custom ranges)
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: period, in: query, schema: { type: string, enum: [last_7_days, last_30_days, last_12_months, custom] } }
 *       - { name: from, in: query, schema: { type: string, format: date }, description: Required with period=custom }
 *       - { name: to, in: query, schema: { type: string, format: date }, description: Required with period=custom }
 *     responses:
 *       200: { description: Overview }
 *       403: { description: Period requires a paid tier }
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = await resolveAgencyTier(agencyId);
    const { period, from, to, error } = parsePeriodFromQuery(
      req.query as Record<string, string | undefined>, tier
    );
    if (error) { res.status(403).json({ error }); return; }
    const range = resolveDateRange(period, from, to);
    const data  = await getOverviewAnalytics(agencyId, range, period);
    res.json(data);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * @openapi
 * /agencies/me/analytics/packages:
 *   get:
 *     tags: [Analytics]
 *     summary: Per-package analytics for the same date-range rules as the overview
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: Package analytics }, 403: { description: Period requires a paid tier } }
 */
router.get("/packages", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = await resolveAgencyTier(agencyId);
    const { period, from, to, error } = parsePeriodFromQuery(
      req.query as Record<string, string | undefined>, tier
    );
    if (error) { res.status(403).json({ error }); return; }
    const range = resolveDateRange(period, from, to);
    const data  = await getPackageAnalytics(agencyId, range);
    res.json(data);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * @openapi
 * /agencies/me/analytics/customers:
 *   get:
 *     tags: [Analytics]
 *     summary: Customer analytics for the same date-range rules as the overview
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: Customer analytics }, 403: { description: Period requires a paid tier } }
 */
router.get("/customers", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = await resolveAgencyTier(agencyId);
    const { period, from, to, error } = parsePeriodFromQuery(
      req.query as Record<string, string | undefined>, tier
    );
    if (error) { res.status(403).json({ error }); return; }
    const range = resolveDateRange(period, from, to);
    const data  = await getCustomerAnalytics(agencyId, range);
    res.json(data);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * @openapi
 * /agencies/me/analytics/guides:
 *   get:
 *     tags: [Analytics]
 *     summary: Guide analytics for the same date-range rules as the overview
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: Guide analytics }, 403: { description: Period requires a paid tier } }
 */
router.get("/guides", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = await resolveAgencyTier(agencyId);
    const { period, from, to, error } = parsePeriodFromQuery(
      req.query as Record<string, string | undefined>, tier
    );
    if (error) { res.status(403).json({ error }); return; }
    const range = resolveDateRange(period, from, to);
    const data  = await getGuideAnalytics(agencyId, range);
    res.json(data);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;