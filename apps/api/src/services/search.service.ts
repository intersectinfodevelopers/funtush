import { db } from "@funtush/database";
import { getMeili, isSearchEnabled } from "../lib/meilisearch.js";

export const PACKAGE_INDEX = "packages";
export const AGENCY_INDEX = "agencies";

// Fallback only — used if an agency's AgencyVisibilityScore hasn't been
// calculated yet (e.g. brand new, before first cron run).
const FALLBACK_BASE_SCORE_BY_TIER: Record<string, number> = {
  LARGE: 100,
  MEDIUM: 50,
  SMALL: 25,
  FREE: 0,
};

export const HIDDEN_TIERS = ["FREE"];

export interface PackageDocument {
  id: string;
  agencyId: string;
  agencyName: string;
  title: string;
  description: string;
  destination: string[];
  season: string[];
  difficulty: string;
  price: number;
  duration: number;
  altitude: number;
  status: string;
  slug: string;
  tier: string;
  visibilityScore: number;
  sponsored: boolean;
  agencyRating: number;
  createdAt: number;
}

export interface AgencyDocument {
  id: string;
  name: string;
  description: string;
  destinations: string[];
  tier: string;
  region: string[];
  rating: number;
  slug: string;
  status: string;
}

export async function configureIndexes(): Promise<void> {
  if (!isSearchEnabled()) {
    console.warn("[search] MEILI_HOST not configured — skipping index setup");
    return;
  }

  try {
    const meili = getMeili();
    await meili.createIndex(PACKAGE_INDEX, { primaryKey: "id" }).catch(() => undefined);
    await meili.createIndex(AGENCY_INDEX, { primaryKey: "id" }).catch(() => undefined);

    await meili.index(PACKAGE_INDEX).updateSettings({
      searchableAttributes: ["title", "description", "destination", "agencyName"],
      filterableAttributes: ["difficulty", "price", "duration", "season", "altitude", "status", "agencyId", "tier"],
      sortableAttributes: ["price", "duration", "altitude", "createdAt", "visibilityScore", "agencyRating"],
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
      },
    });

    await meili.index(AGENCY_INDEX).updateSettings({
      searchableAttributes: ["name", "description", "destinations"],
      filterableAttributes: ["tier", "region", "rating", "status"],
      sortableAttributes: ["rating"],
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
      },
    });

    console.log("[search] Meilisearch indexes configured (packages, agencies)");
  } catch (err) {
    console.error("[search] Failed to configure indexes:", (err as Error).message);
  }
}

// groupBy avoids N+1 queries during bulk reindex.
async function getAgencyRatingMap(): Promise<Map<string, number>> {
  const rows = await db.review.groupBy({
    by: ["agencyId"],
    _avg: { rating: true },
  });
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.agencyId, row._avg.rating ?? 0);
  }
  return map;
}

async function getAgencyRating(agencyId: string): Promise<number> {
  const agg = await db.review.aggregate({
    where: { agencyId },
    _avg: { rating: true },
  });
  return agg._avg.rating ?? 0;
}

type PackageWithRelations = {
  id: string;
  agencyId: string;
  title: string;
  slug: string;
  description: string | null;
  durationDays: number;
  pricePerPerson: unknown;
  difficulty: string;
  status: string;
  createdAt: Date;
  agency: {
    name: string;
    priorityOverride: number;
    tier?: { name: string } | null;
    visibilityScore?: { finalScore: number } | null;
  };
  destinations: { name: string; bestSeason: string | null; altitudeM: number | null }[];
  itineraries: { altitudeM: number | null }[];
};

// agencyRating passed in (not fetched here) so callers can batch it instead of N+1ing.
export function toPackageDocument(
  pkg: PackageWithRelations,
  agencyRating: number
): PackageDocument {
  const altitudes = [
    ...pkg.destinations.map((d) => d.altitudeM ?? 0),
    ...pkg.itineraries.map((i) => i.altitudeM ?? 0),
  ];
  const altitude = altitudes.length ? Math.max(...altitudes) : 0;

  const season = [...new Set(pkg.destinations.map((d) => d.bestSeason).filter(Boolean) as string[])];

  const tier = pkg.agency.tier?.name ?? "SMALL";
  const visibilityScore =
    pkg.agency.visibilityScore?.finalScore ?? FALLBACK_BASE_SCORE_BY_TIER[tier] ?? 0;

  return {
    id: pkg.id,
    agencyId: pkg.agencyId,
    agencyName: pkg.agency.name,
    title: pkg.title,
    description: pkg.description ?? "",
    destination: pkg.destinations.map((d) => d.name),
    season,
    difficulty: pkg.difficulty,
    price: Number(pkg.pricePerPerson),
    duration: pkg.durationDays,
    altitude,
    status: pkg.status,
    slug: pkg.slug,
    tier,
    visibilityScore,
    sponsored: pkg.agency.priorityOverride > 0,
    agencyRating,
    createdAt: Math.floor(pkg.createdAt.getTime() / 1000),
  };
}

type AgencyWithRelations = {
  id: string;
  name: string;
  slug: string;
  status: string;
  tier: { name: string };
  profile: { description: string | null; regions: unknown } | null;
  destinations: { name: string }[];
};

export function toAgencyDocument(agency: AgencyWithRelations, rating: number): AgencyDocument {
  const rawRegions = agency.profile?.regions;
  const region = Array.isArray(rawRegions)
    ? (rawRegions.filter((r) => typeof r === "string") as string[])
    : typeof rawRegions === "string"
      ? [rawRegions]
      : [];

  return {
    id: agency.id,
    name: agency.name,
    description: agency.profile?.description ?? "",
    destinations: agency.destinations.map((d) => d.name),
    tier: agency.tier.name,
    region,
    rating,
    slug: agency.slug,
    status: agency.status,
  };
}

const PACKAGE_INCLUDE = {
  agency: {
    select: {
      name: true,
      priorityOverride: true,
      tier: { select: { name: true } },
      visibilityScore: { select: { finalScore: true } },
    },
  },
  destinations: { select: { name: true, bestSeason: true, altitudeM: true } },
  itineraries: { select: { altitudeM: true } },
} as const;

export async function indexPackage(packageId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    const pkg = await db.trekPackage.findUnique({
      where: { id: packageId },
      include: PACKAGE_INCLUDE,
    });
    if (!pkg) return;

    const rating = await getAgencyRating(pkg.agencyId);
    await getMeili()
      .index(PACKAGE_INDEX)
      .addDocuments([toPackageDocument(pkg as PackageWithRelations, rating)]);
  } catch (err) {
    console.error(`[search] Failed to index package ${packageId}:`, (err as Error).message);
  }
}

export async function removePackage(packageId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    await getMeili().index(PACKAGE_INDEX).deleteDocument(packageId);
  } catch (err) {
    console.error(`[search] Failed to remove package ${packageId}:`, (err as Error).message);
  }
}

export async function indexAgency(agencyId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    const agency = await db.agency.findUnique({
      where: { id: agencyId },
      include: {
        tier: { select: { name: true } },
        profile: { select: { description: true, regions: true } },
        destinations: { select: { name: true } },
      },
    });
    if (!agency) return;

    const rating = await getAgencyRating(agencyId);
    await getMeili()
      .index(AGENCY_INDEX)
      .addDocuments([toAgencyDocument(agency as AgencyWithRelations, rating)]);
  } catch (err) {
    console.error(`[search] Failed to index agency ${agencyId}:`, (err as Error).message);
  }
}

export async function removeAgency(agencyId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    await getMeili().index(AGENCY_INDEX).deleteDocument(agencyId);
  } catch (err) {
    console.error(`[search] Failed to remove agency ${agencyId}:`, (err as Error).message);
  }
}

// Used by PATCH /admin/agencies/:id/visibility so an override change shows
// up in search immediately, not just at the next full reindex.
export async function reindexAgencyPackages(agencyId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    const packages = await db.trekPackage.findMany({
      where: { agencyId, status: "PUBLISHED" },
      include: PACKAGE_INCLUDE,
    });
    if (!packages.length) return;

    const rating = await getAgencyRating(agencyId);
    const docs = packages.map((p) => toPackageDocument(p as PackageWithRelations, rating));
    await getMeili().index(PACKAGE_INDEX).addDocuments(docs);
  } catch (err) {
    console.error(`[search] Failed to reindex packages for agency ${agencyId}:`, (err as Error).message);
  }
}

export async function reindexAll(): Promise<{ packages: number; agencies: number }> {
  if (!isSearchEnabled()) {
    console.warn("[search] MEILI_HOST not configured — skipping reindex");
    return { packages: 0, agencies: 0 };
  }

  await configureIndexes();
  const meili = getMeili();
  const ratingMap = await getAgencyRatingMap();

  const packages = await db.trekPackage.findMany({
    where: { status: "PUBLISHED" },
    include: PACKAGE_INCLUDE,
  });
  if (packages.length) {
    await meili.index(PACKAGE_INDEX).addDocuments(
      packages.map((p) =>
        toPackageDocument(p as PackageWithRelations, ratingMap.get(p.agencyId) ?? 0)
      )
    );
  }

  const agencies = await db.agency.findMany({
    include: {
      tier: { select: { name: true } },
      profile: { select: { description: true, regions: true } },
      destinations: { select: { name: true } },
    },
  });
  if (agencies.length) {
    await meili.index(AGENCY_INDEX).addDocuments(
      agencies.map((a) =>
        toAgencyDocument(a as AgencyWithRelations, ratingMap.get(a.id) ?? 0)
      )
    );
  }

  console.log(`[search] Reindexed ${packages.length} packages, ${agencies.length} agencies`);
  return { packages: packages.length, agencies: agencies.length };
}

// Ranking: relevance (text match) → visibilityScore + loyalty boost →
// agencyRating tie-break → recency tie-break. When q is empty, all hits
// tie at relevance=1, so visibilityScore effectively becomes primary sort.

const PERSONALIZATION_BOOST = 50;
const CANDIDATE_LIMIT = 1000;
const MAX_LIMIT = 50;

const VALID_DIFFICULTIES = new Set(["EASY", "MODERATE", "CHALLENGING", "DIFFICULT"]);

export interface MarketplaceFilters {
  difficulty?: string;
  priceMin?: number;
  priceMax?: number;
  durationMin?: number;
  durationMax?: number;
  altitudeMax?: number;
  season?: string;
  destination?: string;
}

export interface MarketplaceSearchParams {
  q?: string;
  filters?: MarketplaceFilters;
  page?: number;
  limit?: number;
  trekkerUserId?: string;
}

export interface MarketplaceSearchResult {
  data: PackageDocument[];
  meta: { total: number; page: number; limit: number; pages: number };
}

function sanitizeFilterValue(value: string): string {
  return value.replace(/["\\]/g, "").trim();
}

async function bookedAgencyIdsFor(trekkerUserId: string): Promise<Set<string>> {
  const trekker = await db.trekker.findUnique({
    where: { userId: trekkerUserId },
    select: { id: true },
  });
  if (!trekker) return new Set();

  const bookings = await db.booking.findMany({
    where: { trekkerId: trekker.id },
    select: { agencyId: true },
    distinct: ["agencyId"],
  });
  return new Set(bookings.map((b) => b.agencyId));
}

export async function searchMarketplacePackages(
  params: MarketplaceSearchParams
): Promise<MarketplaceSearchResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(params.limit ?? 20)));
  const emptyMeta = { total: 0, page, limit, pages: 0 };

  if (!isSearchEnabled()) {
    console.warn("[search] MEILI_HOST not configured — marketplace search returns empty");
    return { data: [], meta: emptyMeta };
  }

  const f = params.filters ?? {};

  const filterParts: string[] = ['status = "PUBLISHED"'];
  for (const tier of HIDDEN_TIERS) filterParts.push(`tier != "${tier}"`);

  if (f.difficulty && VALID_DIFFICULTIES.has(f.difficulty)) {
    filterParts.push(`difficulty = "${f.difficulty}"`);
  }
  if (typeof f.priceMin === "number") filterParts.push(`price >= ${f.priceMin}`);
  if (typeof f.priceMax === "number") filterParts.push(`price <= ${f.priceMax}`);
  if (typeof f.durationMin === "number") filterParts.push(`duration >= ${f.durationMin}`);
  if (typeof f.durationMax === "number") filterParts.push(`duration <= ${f.durationMax}`);
  if (typeof f.altitudeMax === "number") filterParts.push(`altitude <= ${f.altitudeMax}`);
  if (f.season) filterParts.push(`season = "${sanitizeFilterValue(f.season)}"`);
  if (f.destination) filterParts.push(`destination = "${sanitizeFilterValue(f.destination)}"`);

  let hits: (PackageDocument & { _rankingScore?: number })[];
  try {
    const result = await getMeili().index(PACKAGE_INDEX).search(params.q ?? "", {
      filter: filterParts.join(" AND "),
      limit: CANDIDATE_LIMIT,
      showRankingScore: true,
    });
    hits = result.hits as (PackageDocument & { _rankingScore?: number })[];
  } catch (err) {
    console.error("[search] Marketplace search failed:", (err as Error).message);
    return { data: [], meta: emptyMeta };
  }

  const boostedAgencies = params.trekkerUserId
    ? await bookedAgencyIdsFor(params.trekkerUserId)
    : new Set<string>();

  console.log("[search] trekkerUserId:", params.trekkerUserId);
  console.log("[search] boostedAgencies:", Array.from(boostedAgencies));

  const ranked = hits
    .map((hit) => {
      const relevance = hit._rankingScore ?? 1;
      const loyaltyBoost = boostedAgencies.has(hit.agencyId) ? PERSONALIZATION_BOOST : 0;
      const rankScore = hit.visibilityScore + loyaltyBoost;
      return { hit, relevance, rankScore };
    })
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      if (b.hit.agencyRating !== a.hit.agencyRating) return b.hit.agencyRating - a.hit.agencyRating;
      return b.hit.createdAt - a.hit.createdAt;
    });

  const total = ranked.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = ranked.slice(start, start + limit).map(({ hit, rankScore }) => {
    const { _rankingScore, ...doc } = hit;
    void _rankingScore;
    doc.visibilityScore = rankScore;  // Show the boosted score
    return doc as PackageDocument;
  });

  return { data, meta: { total, page, limit, pages } };
}