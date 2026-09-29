import { db } from "@funtush/database";
import { getAnalyticsCollection } from "../models/analyticsEvent.model.js";
import {
  CURATED_PACKAGE_SELECT,
  PUBLISHED_LISTABLE_PACKAGE,
  toCuratedPackage,
  getFeatured,
  type CuratedPackage,
  type CuratedPackageRow,
} from "./marketplaceCuration.service.js";
import type { TargetingParams } from "./targetingBuilderService.js";

/**
 * ── Behavior-driven recommendations ──────────────────────────────────────────
 *
 * The in-app equivalent of "you looked at a product on Daraz, now you see it on
 * Facebook": a visitor's real PAGE_VIEW history (package views, tied to their
 * trekker id once logged in, or an anonymous `visitor_id` before that) drives
 * which packages get surfaced back to them elsewhere on Funtush — weighted so
 * an agency's real, admin-controlled paid standing actually matters:
 *
 *   - `SubscriptionTier.marketplaceWeight` (Super Admin-configurable per tier,
 *     previously set but never read anywhere — see tierConfig.service.ts) now
 *     directly raises a package's recommendation score.
 *   - An agency's approved, ACTIVE ad campaign (previously tracked/billed but
 *     never placed anywhere — see adCampaignService.ts) now gets real in-app
 *     placement: if the campaign opted into `behavioral.retargetViewers` and
 *     its difficulty targeting matches, a visitor who viewed that agency's
 *     packages sees more of them — literally the Daraz/Meta retargeting
 *     pattern, run with Funtush's own data instead of a third party's.
 *
 * A brand-new visitor with no view history yet gets the existing curated
 * `getFeatured()` mix instead of an empty list.
 */

const HISTORY_WINDOW_DAYS = 30;
const HISTORY_LIMIT = 50;
const CANDIDATE_LIMIT = 200;
const RESULT_LIMIT = 12;

const DESTINATION_MATCH_BONUS = 40;
const DIFFICULTY_MATCH_BONUS = 15;
const SPONSORED_BONUS = 25;
const RETARGETING_BONUS = 60;

// Same fallback used by search.service.ts when a tier's AgencyVisibilityScore
// hasn't been computed yet (brand new agency, before the nightly cron runs).
const FALLBACK_BASE_SCORE_BY_TIER: Record<string, number> = { LARGE: 100, MEDIUM: 50, SMALL: 25, FREE: 0 };

export interface RecommendedPackage extends CuratedPackage {
  reason: string;
}

export interface RecommendationsResult {
  personalized: boolean;
  data: RecommendedPackage[];
}

interface ViewEvent {
  agency_id: string;
  package_id: string | null;
  metadata?: { destination?: string | null; difficulty?: string | null };
}

async function recentViews(trekkerId: string | null, visitorId: string | null): Promise<ViewEvent[]> {
  if (!trekkerId && !visitorId) return [];
  const col = await getAnalyticsCollection();
  const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const or: Record<string, unknown>[] = [];
  if (trekkerId) or.push({ trekker_id: trekkerId });
  if (visitorId) or.push({ "metadata.visitor_id": visitorId });

  const docs = await col
    .find({ event_type: "PAGE_VIEW", timestamp: { $gte: since }, $or: or })
    .sort({ timestamp: -1 })
    .limit(HISTORY_LIMIT)
    .toArray();

  return docs as unknown as ViewEvent[];
}

export async function getRecommendationsFor(
  trekkerId: string | null,
  visitorId: string | null
): Promise<RecommendationsResult> {
  const views = await recentViews(trekkerId, visitorId);

  if (views.length === 0) {
    const featured = await getFeatured();
    const data: RecommendedPackage[] = [
      ...featured.sponsored.map((p) => ({ ...p, reason: "Sponsored" })),
      ...featured.topRated.map((p) => ({ ...p, reason: "Highly rated" })),
      ...featured.mostBookedThisMonth.map((p) => ({ ...p, reason: "Popular this month" })),
    ].slice(0, RESULT_LIMIT);
    return { personalized: false, data };
  }

  const viewedPackageIds = new Set(views.map((v) => v.package_id).filter((id): id is string => !!id));
  const viewedDestinations = new Set(views.map((v) => v.metadata?.destination).filter((d): d is string => !!d));
  const viewedDifficulties = new Set(views.map((v) => v.metadata?.difficulty).filter((d): d is string => !!d));
  const viewedAgencyIds = new Set(views.map((v) => v.agency_id));

  const orFilters: Record<string, unknown>[] = [];
  if (viewedDestinations.size) orFilters.push({ destinations: { some: { name: { in: [...viewedDestinations] } } } });
  if (viewedDifficulties.size) orFilters.push({ difficulty: { in: [...viewedDifficulties] } });
  orFilters.push({ agencyId: { in: [...viewedAgencyIds] } }); // retargeting candidates even off-destination

  const rows = await db.trekPackage.findMany({
    where: {
      ...PUBLISHED_LISTABLE_PACKAGE,
      id: { notIn: [...viewedPackageIds] },
      OR: orFilters,
    },
    take: CANDIDATE_LIMIT,
    orderBy: { createdAt: "desc" },
    select: CURATED_PACKAGE_SELECT,
  });
  if (rows.length === 0) {
    const featured = await getFeatured();
    const data: RecommendedPackage[] = [
      ...featured.sponsored.map((p) => ({ ...p, reason: "Sponsored" })),
      ...featured.topRated.map((p) => ({ ...p, reason: "Highly rated" })),
    ].slice(0, RESULT_LIMIT);
    return { personalized: false, data };
  }

  const agencyIds = [...new Set(rows.map((r) => r.agency.id))];

  const [tiers, visibilityScores, activeCampaigns] = await Promise.all([
    db.subscriptionTier.findMany({ select: { name: true, marketplaceWeight: true } }),
    db.agencyVisibilityScore.findMany({ where: { agencyId: { in: agencyIds } }, select: { agencyId: true, finalScore: true } }),
    db.adCampaign.findMany({
      where: { agencyId: { in: agencyIds }, status: "ACTIVE" },
      select: { agencyId: true, targetingParams: true },
    }),
  ]);

  const weightByTier = new Map(tiers.map((t) => [t.name, t.marketplaceWeight]));
  const visibilityByAgency = new Map(visibilityScores.map((v) => [v.agencyId, v.finalScore]));
  const retargetingDifficultyByAgency = new Map<string, TargetingParams["geographic"]["difficulty"] | undefined>();
  for (const c of activeCampaigns) {
    const p = c.targetingParams as unknown as Partial<TargetingParams> | null;
    if (p?.behavioral?.retargetViewers) retargetingDifficultyByAgency.set(c.agencyId, p.geographic?.difficulty);
  }

  const dest = (row: CuratedPackageRow) => row.destinations.map((d) => d.name);

  const scored = rows.map((row) => {
    let score = visibilityByAgency.get(row.agency.id) ?? FALLBACK_BASE_SCORE_BY_TIER[row.agency.tier.name] ?? 0;
    score += weightByTier.get(row.agency.tier.name) ?? 0;
    if (row.agency.priorityOverride > 0) score += SPONSORED_BONUS;

    const matchedDestination = dest(row).some((d) => viewedDestinations.has(d));
    if (matchedDestination) score += DESTINATION_MATCH_BONUS;
    if (viewedDifficulties.has(row.difficulty)) score += DIFFICULTY_MATCH_BONUS;

    let reason = matchedDestination ? "Because you looked at similar treks" : "Recommended for you";
    if (viewedAgencyIds.has(row.agency.id) && retargetingDifficultyByAgency.has(row.agency.id)) {
      const targetDifficulty = retargetingDifficultyByAgency.get(row.agency.id);
      const difficultyOk = !targetDifficulty || targetDifficulty === "ALL" || targetDifficulty === row.difficulty;
      if (difficultyOk) {
        score += RETARGETING_BONUS;
        reason = `Because you viewed ${row.agency.name}`;
      }
    }

    return { row, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);

  const data: RecommendedPackage[] = scored.slice(0, RESULT_LIMIT).map(({ row, reason }) => ({
    ...toCuratedPackage(row),
    reason,
  }));

  return { personalized: true, data };
}
