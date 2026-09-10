/**
 * ── Marketplace agency ranking (personalised) ─────────────────────────────
 *
 * Powers `GET /marketplace/agencies` — the "find and compare the best agencies"
 * surface. Three things it does that the plain directory (`listAgencies`) did
 * not:
 *
 *   1. **KYC gate.** Only ACTIVE, paid-tier, **KYC-APPROVED** agencies rank.
 *      An unverified agency is not a trustworthy default.
 *   2. **A real ranking.** A composite 0-100 score from tier, rating (smooth
 *      and volume-weighted, no 4.5 cliff), recent demand, marketplace
 *      conversion, freshness, plus the sponsor `priorityOverride`.
 *   3. **Personalisation.** When a signed-in trekker calls it, agencies they
 *      have *completed a trek with* float into their own group and always sort
 *      first; any prior booking is a boost; operating a region the trekker has
 *      trekked is a small boost. Each result carries a `yourHistory` summary.
 *
 * `computeAgencyRankScore` is a pure function of already-gathered signals so it
 * can be unit-tested with no database.
 */

import { db } from "@funtush/database";
import { LISTABLE_AGENCY, roundRating } from "./marketplaceDirectory.service";

/** Listable **and** verified — the hard filter for ranking. */
export const RANKABLE_AGENCY = {
  ...LISTABLE_AGENCY,
  kyc: { status: "APPROVED" as const },
};

const TIER_WEIGHT: Record<string, number> = { LARGE: 1, MEDIUM: 0.6, SMALL: 0.3 };

/* ── Pure scoring ────────────────────────────────────────────────────────── */

export interface RankSignals {
  tierName: string;
  rating: number | null;
  reviewCount: number;
  /** Bookings created for this agency in the last 30 days. */
  recentBookings: number;
  /** Marketplace impressions / clicks in the last 30 days (for a CTR signal). */
  impressions30d: number;
  clicks30d: number;
  publishedPackages: number;
  priorityOverride: number;
}

export interface Personalisation {
  /** COMPLETED bookings this trekker has with the agency. */
  completedWithAgency: number;
  /** Any bookings (inquiry+) this trekker has with the agency. */
  anyBookingsWithAgency: number;
  /** The agency operates in a region the trekker has trekked. */
  regionAffinity: boolean;
}

export interface RankScore {
  score: number;
  relationship: "trekked-with" | "booked-before" | "recommended";
  reasons: string[];
  breakdown: Record<string, number>;
}

/** 0..1 — 3.0★ → 0, 5.0★ → 1, damped toward 0 when there are few reviews. */
export function smoothRatingScore(rating: number | null, reviewCount: number): number {
  if (rating == null) return 0;
  const raw = Math.max(0, Math.min(1, (rating - 3) / 2));
  const confidence = Math.min(1, Math.log10(reviewCount + 1) / 2); // ~1 at ~99 reviews
  return raw * (0.4 + 0.6 * confidence);
}

export function computeAgencyRankScore(
  signals: RankSignals,
  personal: Personalisation = { completedWithAgency: 0, anyBookingsWithAgency: 0, regionAffinity: false },
): RankScore {
  const tierW = TIER_WEIGHT[signals.tierName] ?? 0.3;
  const ratingS = smoothRatingScore(signals.rating, signals.reviewCount);
  const demandS = Math.min(1, Math.log10(signals.recentBookings + 1) / 1.2);
  const ctr = signals.impressions30d > 0 ? signals.clicks30d / signals.impressions30d : 0;
  const conversionS = Math.min(1, ctr * 5); // 20% CTR → full marks
  const freshnessS = signals.publishedPackages > 0 ? Math.min(1, signals.publishedPackages / 5) : 0;

  const breakdown: Record<string, number> = {
    tier: 35 * tierW,
    rating: 30 * ratingS,
    demand: 15 * demandS,
    conversion: 10 * conversionS,
    freshness: 10 * freshnessS,
    sponsor: Math.max(0, Math.min(15, signals.priorityOverride)),
  };

  let score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const reasons: string[] = [];

  if ((signals.rating ?? 0) >= 4.7 && signals.reviewCount >= 20) reasons.push("Top rated");
  if (signals.tierName === "LARGE") reasons.push("Established operator");
  if (signals.recentBookings >= 10) reasons.push("In demand right now");
  if (signals.priorityOverride > 0) reasons.push("Sponsored");

  let relationship: RankScore["relationship"] = "recommended";
  if (personal.completedWithAgency > 0) {
    relationship = "trekked-with";
    breakdown.history = 1000; // guarantees the "trekked with" group sorts first
    score += 1000;
    reasons.unshift(
      `You've completed ${personal.completedWithAgency} trek${personal.completedWithAgency === 1 ? "" : "s"} with them`,
    );
  } else if (personal.anyBookingsWithAgency > 0) {
    relationship = "booked-before";
    breakdown.history = 25;
    score += 25;
    reasons.unshift("You've booked with them before");
  } else if (personal.regionAffinity) {
    breakdown.affinity = 12;
    score += 12;
    reasons.push("Operates in a region you've trekked");
  }

  return { score: Math.round(score), relationship, reasons: reasons.slice(0, 3), breakdown };
}

/* ── Data gathering + ranking ────────────────────────────────────────────── */

export interface RankedAgencyItem {
  id: string;
  name: string;
  slug: string;
  tier: string;
  logo: string | null;
  description: string | null;
  rating: { average: number | null; count: number };
  regions: string[];
  topDestinations: string[];
  badges: string[];
  score: number;
  relationship: RankScore["relationship"];
  reasons: string[];
  yourHistory: {
    bookingCount: number;
    completedCount: number;
    lastTrek: { packageTitle: string; date: string | null; status: string } | null;
  } | null;
}

export interface RankAgenciesResult {
  trekkedWith: RankedAgencyItem[];
  recommended: RankedAgencyItem[];
  meta: { total: number; personalised: boolean };
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export async function rankAgencies(opts: {
  trekkerId?: string | null;
  filters?: { region?: string; tier?: string; minRating?: number; search?: string; limit?: number };
}): Promise<RankAgenciesResult> {
  const { trekkerId, filters = {} } = opts;
  const since = new Date(Date.now() - THIRTY_DAYS_MS);

  const where: Record<string, unknown> = { ...RANKABLE_AGENCY };
  if (filters.tier) where.tier = { name: filters.tier };
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { profile: { description: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const agencies = await db.agency.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      priorityOverride: true,
      tier: { select: { name: true } },
      kyc: { select: { status: true } },
      profile: { select: { logo: true, description: true, regions: true } },
      destinations: { select: { name: true, _count: { select: { packages: true } } } },
      _count: { select: { packages: { where: { status: "PUBLISHED" } } } },
    },
  });

  const agencyIds = agencies.map((a) => a.id);
  if (agencyIds.length === 0) {
    return { trekkedWith: [], recommended: [], meta: { total: 0, personalised: Boolean(trekkerId) } };
  }

  // Batched signals — one query each, not one per agency.
  const [ratingGroups, bookingGroups, impressionGroups] = await Promise.all([
    db.review.groupBy({
      by: ["agencyId"],
      where: { agencyId: { in: agencyIds }, verified: true },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    db.booking.groupBy({
      by: ["agencyId"],
      where: { agencyId: { in: agencyIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.marketplaceImpression.groupBy({
      by: ["agencyId"],
      where: { agencyId: { in: agencyIds }, date: { gte: since } },
      _sum: { impressionCount: true, clickCount: true },
    }),
  ]);

  const ratingBy = new Map(ratingGroups.map((r) => [r.agencyId, r]));
  const bookingBy = new Map(bookingGroups.map((b) => [b.agencyId, b._count._all]));
  const impressionBy = new Map(impressionGroups.map((i) => [i.agencyId, i._sum]));

  // Personalisation inputs.
  let historyBy = new Map<string, { total: number; completed: number; last: { packageTitle: string; date: string | null; status: string } | null }>();
  const myRegions = new Set<string>();
  const personalised = Boolean(trekkerId);

  if (trekkerId) {
    const trekker = await db.trekker.findUnique({ where: { userId: trekkerId }, select: { id: true } });
    if (trekker) {
      const myBookings = await db.booking.findMany({
        where: { trekkerId: trekker.id },
        select: {
          agencyId: true,
          status: true,
          createdAt: true,
          package: { select: { title: true, destinations: { select: { name: true } } } },
          departureDate: { select: { startDate: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      historyBy = new Map();
      for (const b of myBookings) {
        const entry = historyBy.get(b.agencyId) ?? { total: 0, completed: 0, last: null };
        entry.total += 1;
        if (b.status === "COMPLETED") entry.completed += 1;
        if (!entry.last) {
          entry.last = {
            packageTitle: b.package?.title ?? "a trek",
            date: b.departureDate?.startDate.toISOString().slice(0, 10) ?? null,
            status: b.status,
          };
        }
        historyBy.set(b.agencyId, entry);
        for (const d of b.package?.destinations ?? []) myRegions.add(d.name.toLowerCase());
      }
    }
  }

  const items: RankedAgencyItem[] = agencies.map((a) => {
    const rAgg = ratingBy.get(a.id);
    const rating = rAgg?._avg.rating ?? null;
    const reviewCount = rAgg?._count.rating ?? 0;
    const impr = impressionBy.get(a.id);
    const regions = toStringArray(a.profile?.regions);
    const hist = historyBy.get(a.id) ?? null;

    const regionAffinity =
      !hist &&
      personalised &&
      [...regions, ...a.destinations.map((d) => d.name)].some((r) => myRegions.has(r.toLowerCase()));

    const scoreResult = computeAgencyRankScore(
      {
        tierName: a.tier.name,
        rating,
        reviewCount,
        recentBookings: bookingBy.get(a.id) ?? 0,
        impressions30d: impr?.impressionCount ?? 0,
        clicks30d: impr?.clickCount ?? 0,
        publishedPackages: a._count.packages,
        priorityOverride: a.priorityOverride,
      },
      {
        completedWithAgency: hist?.completed ?? 0,
        anyBookingsWithAgency: hist?.total ?? 0,
        regionAffinity,
      },
    );

    const badges: string[] = ["Verified"]; // RANKABLE_AGENCY guarantees KYC APPROVED
    if (rating != null && roundRating(rating)! >= 4.5 && reviewCount >= 5) badges.push("Top Rated");
    if (a.priorityOverride > 0) badges.push("Sponsored");

    return {
      id: a.id,
      name: a.name,
      slug: a.slug,
      tier: a.tier.name,
      logo: a.profile?.logo ?? null,
      description: a.profile?.description ?? null,
      rating: { average: roundRating(rating), count: reviewCount },
      regions,
      topDestinations: [...a.destinations]
        .sort((x, y) => y._count.packages - x._count.packages)
        .slice(0, 5)
        .map((d) => d.name),
      badges,
      score: scoreResult.score,
      relationship: scoreResult.relationship,
      reasons: scoreResult.reasons,
      yourHistory: hist
        ? { bookingCount: hist.total, completedCount: hist.completed, lastTrek: hist.last }
        : null,
    };
  });

  // Region / rating filters run in app code (regions are JSON, rating is joined).
  let filtered = items;
  if (filters.region) {
    const needle = filters.region.toLowerCase();
    filtered = filtered.filter((i) =>
      [...i.regions, ...i.topDestinations].some((r) => r.toLowerCase() === needle),
    );
  }
  if (typeof filters.minRating === "number") {
    filtered = filtered.filter((i) => (i.rating.average ?? 0) >= filters.minRating!);
  }

  filtered.sort((a, b) => b.score - a.score);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const capped = filtered.slice(0, limit);

  return {
    trekkedWith: capped.filter((i) => i.relationship === "trekked-with"),
    recommended: capped.filter((i) => i.relationship !== "trekked-with"),
    meta: { total: filtered.length, personalised },
  };
}

/* ── Compare ─────────────────────────────────────────────────────────────── */

export interface AgencyComparison {
  slug: string;
  name: string;
  tier: string;
  logo: string | null;
  verified: boolean;
  rating: { average: number | null; count: number };
  priceRange: { min: number; max: number } | null;
  packageCount: number;
  regions: string[];
  memberSince: string;
  badges: string[];
  yourHistory: {
    bookingCount: number;
    completedCount: number;
    lastTrek: { packageTitle: string; date: string | null; status: string } | null;
  } | null;
}

/**
 * Side-by-side data for 2-4 agencies the trekker picked. Unlike the ranked list
 * this does **not** hide non-verified agencies — the trekker explicitly asked
 * for these slugs, and a `verified: false` cell is exactly the kind of thing a
 * comparison should surface, not omit. It still requires the agency to be
 * listable (ACTIVE, paid) so a suspended agency can't be linked into a compare.
 */
export async function compareAgencies(
  slugs: string[],
  trekkerId?: string | null,
): Promise<AgencyComparison[]> {
  const wanted = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 4);
  if (wanted.length < 2) {
    const err = new Error("Pick between 2 and 4 agencies to compare") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const agencies = await db.agency.findMany({
    where: { slug: { in: wanted }, ...LISTABLE_AGENCY },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      priorityOverride: true,
      tier: { select: { name: true } },
      kyc: { select: { status: true } },
      profile: { select: { logo: true, regions: true } },
      packages: {
        where: { status: "PUBLISHED" },
        select: { pricePerPerson: true, destinations: { select: { name: true } } },
      },
    },
  });

  const ratingGroups = await db.review.groupBy({
    by: ["agencyId"],
    where: { agencyId: { in: agencies.map((a) => a.id) }, verified: true },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const ratingBy = new Map(ratingGroups.map((r) => [r.agencyId, r]));

  type LastTrek = { packageTitle: string; date: string | null; status: string } | null;
  let historyBy = new Map<string, { total: number; completed: number; last: LastTrek }>();
  if (trekkerId) {
    const trekker = await db.trekker.findUnique({ where: { userId: trekkerId }, select: { id: true } });
    if (trekker) {
      const myBookings = await db.booking.findMany({
        where: { trekkerId: trekker.id, agencyId: { in: agencies.map((a) => a.id) } },
        select: {
          agencyId: true,
          status: true,
          package: { select: { title: true } },
          departureDate: { select: { startDate: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      historyBy = new Map();
      for (const b of myBookings) {
        const e = historyBy.get(b.agencyId) ?? { total: 0, completed: 0, last: null };
        e.total += 1;
        if (b.status === "COMPLETED") e.completed += 1;
        if (!e.last) {
          e.last = {
            packageTitle: b.package?.title ?? "a trek",
            date: b.departureDate?.startDate.toISOString().slice(0, 10) ?? null,
            status: b.status,
          };
        }
        historyBy.set(b.agencyId, e);
      }
    }
  }

  // Preserve the order the trekker asked for.
  const bySlug = new Map(agencies.map((a) => [a.slug.toLowerCase(), a]));

  return wanted
    .map((slug) => bySlug.get(slug))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => {
      const rAgg = ratingBy.get(a.id);
      const prices = a.packages.map((p) => Number(p.pricePerPerson)).filter((n) => n > 0);
      const regions = toStringArray(a.profile?.regions);
      const destRegions = [...new Set(a.packages.flatMap((p) => p.destinations.map((d) => d.name)))];
      const hist = historyBy.get(a.id) ?? null;

      const badges: string[] = [];
      if (a.kyc?.status === "APPROVED") badges.push("Verified");
      const avg = roundRating(rAgg?._avg.rating ?? null);
      if (avg != null && avg >= 4.5 && (rAgg?._count.rating ?? 0) >= 5) badges.push("Top Rated");
      if (a.priorityOverride > 0) badges.push("Sponsored");

      return {
        slug: a.slug,
        name: a.name,
        tier: a.tier.name,
        logo: a.profile?.logo ?? null,
        verified: a.kyc?.status === "APPROVED",
        rating: { average: avg, count: rAgg?._count.rating ?? 0 },
        priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
        packageCount: a.packages.length,
        regions: regions.length ? regions : destRegions,
        memberSince: a.createdAt.toISOString().slice(0, 10),
        badges,
        yourHistory: hist
          ? { bookingCount: hist.total, completedCount: hist.completed, lastTrek: hist.last }
          : null,
      };
    });
}
