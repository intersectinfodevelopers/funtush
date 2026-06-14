import { Router } from "express";
import type { Request, Response } from "express";
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

function parsePeriodFromQuery(
  query: Record<string, string | undefined>,
  tier?: string
): { period: Period; from?: string; to?: string; error?: string } {
  const period = (query.period as Period) ?? "last_30_days";
  const from   = query.from;
  const to     = query.to;

  const allowedPeriods = (tier === "MEDIUM" || tier === "LARGE" || tier === "ENTERPRISE")
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

router.get("/", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = (req as unknown as { tier?: string }).tier;
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

router.get("/packages", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = (req as unknown as { tier?: string }).tier;
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

router.get("/customers", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = (req as unknown as { tier?: string }).tier;
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

router.get("/guides", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const tier = (req as unknown as { tier?: string }).tier;
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