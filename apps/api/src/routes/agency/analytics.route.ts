import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@funtush/database";
import {
  resolveDateRange,
  getOverviewAnalytics,
  getPackageAnalytics,
  getCustomerAnalytics,
  getGuideAnalytics,
  getOriginPackagePerformance,
  type Period,
} from "../../services/agencyAnalytics.service";

const router = Router();

/** The analytics events only carry ids; attach display names, scoped to this agency. */
async function packageTitles(agencyId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.trekPackage.findMany({ where: { agencyId, id: { in: ids } }, select: { id: true, title: true } });
  return new Map(rows.map((r) => [r.id, r.title]));
}
async function guideNames(agencyId: string, refs: string[]) {
  if (!refs.length) return new Map<string, string>();
  const rows = await db.guideProfile.findMany({ where: { agencyId, guideRef: { in: refs } }, select: { guideRef: true, fullName: true } });
  return new Map(rows.map((r) => [r.guideRef, r.fullName]));
}
async function trekkerNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.trekker.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return new Map(rows.filter((r) => r.fullName).map((r) => [r.id, r.fullName as string]));
}

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
    const titles = await packageTitles(agencyId, [...new Set([...data.topByBookings, ...data.topByRevenue].map((p) => p.package_id))]);
    const named = <T extends { package_id: string }>(l: T[]) => l.map((p) => ({ ...p, title: titles.get(p.package_id) ?? null }));
    res.json({ ...data, topByBookings: named(data.topByBookings), topByRevenue: named(data.topByRevenue) });
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
    const names = await trekkerNames(data.topCustomers.map((c: { trekker_id: string }) => c.trekker_id));
    res.json({ ...data, topCustomers: data.topCustomers.map((c: { trekker_id: string }) => ({ ...c, name: names.get(c.trekker_id) ?? null })) });
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
    const names = await guideNames(agencyId, data.guides.map((g) => g.guide_id));
    res.json({ ...data, guides: data.guides.map((g) => ({ ...g, name: names.get(g.guide_id) ?? null })) });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * @openapi
 * /agencies/me/analytics/origin-performance:
 *   get:
 *     tags: [Analytics]
 *     summary: Bookings/revenue grouped by trekker origin country and package (from real bookings, not Mongo events)
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: Origin × package performance }, 403: { description: Period requires a paid tier } }
 */
router.get("/origin-performance", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = await resolveAgencyTier(agencyId);
    const { period, from, to, error } = parsePeriodFromQuery(
      req.query as Record<string, string | undefined>, tier
    );
    if (error) { res.status(403).json({ error }); return; }
    const range = resolveDateRange(period, from, to);
    const data = await getOriginPackagePerformance(agencyId, range);
    res.json({ rows: data });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;