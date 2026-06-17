import { db } from "@funtush/database";
import { getMeili, isSearchEnabled } from "../lib/meilisearch.js";

/**
 * ── Search index service (Week 3 · Day 1) ───────────────────────────────────
 *
 * This is the ONLY place that talks to Meilisearch. It owns two indexes:
 *
 *   "packages"  — every PUBLISHED trek package, for the marketplace search box
 *   "agencies"  — every agency, for the agency directory
 *
 * Responsibilities for Day 1:
 *   1. configureIndexes()  — create both indexes and set their searchable /
 *                            filterable / sortable attributes + typo tolerance.
 *   2. document mappers     — turn a Postgres row (with relations) into the flat
 *                            JSON document Meilisearch stores.
 *   3. sync helpers         — index / remove a single package or agency.
 *   4. reindexAll()         — rebuild both indexes from scratch (bootstrap / repair).
 *
 * Everything is defensive: if Meilisearch is not configured or is unreachable,
 * the functions log and return instead of throwing. Indexing a package must
 * never break the publish request that triggered it.
 */

export const PACKAGE_INDEX = "packages";
export const AGENCY_INDEX = "agencies";

/* ── Tier visibility (Week 3 · Day 2) ────────────────────────────────────────
 *
 * Marketplace ranking gives bigger tiers more exposure (Backend Guide §6 & §14):
 *   Large  → highest weight, Medium → medium, Small → low, Free → HIDDEN.
 *
 * The weight is baked into each package document at index time so the search
 * query can rank purely on data it already holds. FREE-tier packages are still
 * indexed, but the marketplace query filters them out (`tier != "FREE"`), so
 * they never appear publicly — they only exist for the agency's own dashboard.
 */
export const TIER_WEIGHTS: Record<string, number> = {
  LARGE: 100,
  MEDIUM: 50,
  SMALL: 20,
  FREE: 0,
};

/** Tiers that must never be listed on the public marketplace. */
export const HIDDEN_TIERS = ["FREE"];

/** Look up a tier's weight, defaulting unknown tiers to the lowest visible weight. */
function tierWeight(tierName: string | undefined): number {
  return TIER_WEIGHTS[tierName ?? "SMALL"] ?? TIER_WEIGHTS.SMALL;
}

/* ── Document shapes ─────────────────────────────────────────────────────── */

export interface PackageDocument {
  id: string;
  agencyId: string;
  agencyName: string;
  title: string;
  description: string;
  // M2M destinations flattened to plain arrays so Meili can search/filter them.
  destination: string[];
  season: string[];
  // filterable / sortable numeric + enum fields
  difficulty: string;
  price: number;
  duration: number;
  altitude: number;
  status: string;
  slug: string;
  // tier of the owning agency + its precomputed marketplace weight. Drives
  // visibility ranking and the FREE-tier hide rule (Day 2).
  tier: string;
  tierWeight: number;
  createdAt: number; // unix seconds — sortable
}

export interface AgencyDocument {
  id: string;
  name: string;
  description: string;
  destinations: string[];
  tier: string;
  region: string[];
  rating: number; // placeholder until the review system (Week 3) lands
  slug: string;
  status: string;
}

/* ── Index configuration ─────────────────────────────────────────────────── */

/**
 * Create both indexes (if missing) and apply their settings. Idempotent —
 * safe to call on every server boot. Meilisearch applies settings as async
 * "tasks"; we don't await their completion here because boot shouldn't block on it.
 */
export async function configureIndexes(): Promise<void> {
  if (!isSearchEnabled()) {
    console.warn("[search] MEILI_HOST not configured — skipping index setup");
    return;
  }

  try {
    const meili = getMeili();
    // `createIndex` is a no-op task if the index already exists.
    await meili.createIndex(PACKAGE_INDEX, { primaryKey: "id" }).catch(() => undefined);
    await meili.createIndex(AGENCY_INDEX, { primaryKey: "id" }).catch(() => undefined);

    await meili.index(PACKAGE_INDEX).updateSettings({
      // order matters: earlier attributes weigh more in relevance ranking
      searchableAttributes: ["title", "description", "destination", "agencyName"],
      filterableAttributes: ["difficulty", "price", "duration", "season", "altitude", "status", "agencyId", "tier"],
      sortableAttributes: ["price", "duration", "altitude", "createdAt", "tierWeight"],
      // Typo tolerance: "Anapurna" → "Annapurna", "Everst" → "Everest".
      // Enabled by default in Meili; we set it explicitly so the contract is
      // visible and protected against server-default changes.
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
    // Don't crash boot if Meili is down — the API still serves everything else.
    console.error("[search] Failed to configure indexes:", (err as Error).message);
  }
}

/* ── Mappers: Postgres row → search document ─────────────────────────────── */

type PackageWithRelations = {
  id: string;
  agencyId: string;
  title: string;
  slug: string;
  description: string | null;
  durationDays: number;
  pricePerPerson: unknown; // Prisma Decimal
  difficulty: string;
  status: string;
  createdAt: Date;
  agency: { name: string; tier?: { name: string } | null };
  destinations: { name: string; bestSeason: string | null; altitudeM: number | null }[];
  itineraries: { altitudeM: number | null }[];
};

export function toPackageDocument(pkg: PackageWithRelations): PackageDocument {
  // highest altitude we know about — from destinations or itinerary days
  const altitudes = [
    ...pkg.destinations.map((d) => d.altitudeM ?? 0),
    ...pkg.itineraries.map((i) => i.altitudeM ?? 0),
  ];
  const altitude = altitudes.length ? Math.max(...altitudes) : 0;

  // dedupe seasons across destinations, dropping nulls
  const season = [...new Set(pkg.destinations.map((d) => d.bestSeason).filter(Boolean) as string[])];

  const tier = pkg.agency.tier?.name ?? "SMALL";

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
    tierWeight: tierWeight(tier),
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

export function toAgencyDocument(agency: AgencyWithRelations): AgencyDocument {
  // regions is a JSON column — normalize to a string[] regardless of how it was stored
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
    rating: 0, // populated once reviews exist (Week 3 review system)
    slug: agency.slug,
    status: agency.status,
  };
}

/* ── Sync helpers: one package / one agency ──────────────────────────────── */

/**
 * Push a single package into the search index. Called (fire-and-forget) when a
 * package is published. Reads the package fresh from Postgres with the relations
 * the document needs, so callers don't have to assemble it.
 */
export async function indexPackage(packageId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    const pkg = await db.trekPackage.findUnique({
      where: { id: packageId },
      include: {
        agency: { select: { name: true, tier: { select: { name: true } } } },
        destinations: { select: { name: true, bestSeason: true, altitudeM: true } },
        itineraries: { select: { altitudeM: true } },
      },
    });
    if (!pkg) return;

    await getMeili().index(PACKAGE_INDEX).addDocuments([toPackageDocument(pkg as PackageWithRelations)]);
  } catch (err) {
    console.error(`[search] Failed to index package ${packageId}:`, (err as Error).message);
  }
}

/** Remove a package from the index (e.g. when archived/unpublished). */
export async function removePackage(packageId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    await getMeili().index(PACKAGE_INDEX).deleteDocument(packageId);
  } catch (err) {
    console.error(`[search] Failed to remove package ${packageId}:`, (err as Error).message);
  }
}

/** Push a single agency into the agency directory index. */
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

    await getMeili().index(AGENCY_INDEX).addDocuments([toAgencyDocument(agency as AgencyWithRelations)]);
  } catch (err) {
    console.error(`[search] Failed to index agency ${agencyId}:`, (err as Error).message);
  }
}

/** Remove an agency from the directory index. */
export async function removeAgency(agencyId: string): Promise<void> {
  if (!isSearchEnabled()) return;
  try {
    await getMeili().index(AGENCY_INDEX).deleteDocument(agencyId);
  } catch (err) {
    console.error(`[search] Failed to remove agency ${agencyId}:`, (err as Error).message);
  }
}

/* ── Bulk rebuild ────────────────────────────────────────────────────────── */

/**
 * Rebuild both indexes from the database. Run once after first wiring up
 * Meilisearch, or to repair drift. Only PUBLISHED packages are indexed —
 * drafts/archived packages must never show up in the public marketplace.
 */
export async function reindexAll(): Promise<{ packages: number; agencies: number }> {
  if (!isSearchEnabled()) {
    console.warn("[search] MEILI_HOST not configured — skipping reindex");
    return { packages: 0, agencies: 0 };
  }

  await configureIndexes();
  const meili = getMeili();

  const packages = await db.trekPackage.findMany({
    where: { status: "PUBLISHED" },
    include: {
      agency: { select: { name: true } },
      destinations: { select: { name: true, bestSeason: true, altitudeM: true } },
      itineraries: { select: { altitudeM: true } },
    },
  });
  if (packages.length) {
    await meili
      .index(PACKAGE_INDEX)
      .addDocuments(packages.map((p) => toPackageDocument(p as PackageWithRelations)));
  }

  const agencies = await db.agency.findMany({
    include: {
      tier: { select: { name: true } },
      profile: { select: { description: true, regions: true } },
      destinations: { select: { name: true } },
    },
  });
  if (agencies.length) {
    await meili
      .index(AGENCY_INDEX)
      .addDocuments(agencies.map((a) => toAgencyDocument(a as AgencyWithRelations)));
  }

  console.log(`[search] Reindexed ${packages.length} packages, ${agencies.length} agencies`);
  return { packages: packages.length, agencies: agencies.length };
}

/* ── Marketplace search (Week 3 · Day 2) ─────────────────────────────────────
 *
 * Public-facing search for `GET /marketplace/packages`. Implements:
 *   • full-text search (q) with typo tolerance, via Meilisearch
 *   • filters: difficulty, price range, duration range, season, destination, altitude
 *   • tier visibility: Large > Medium > Small, Free hidden
 *   • personalization: logged-in trekkers get a boost on agencies they booked before
 *   • pagination with meta.total / meta.pages
 *
 * Ranking strategy
 * ────────────────
 * Meilisearch is excellent at TEXT relevance but cannot apply our custom,
 * per-request visibility score (tier weight + "have I booked this agency?").
 * So we use the standard "fetch then re-rank" pattern:
 *   1. Ask Meili for a generous candidate set, already filtered + relevance-ranked,
 *      asking it to attach its own `_rankingScore` (0..1) to every hit.
 *   2. Re-rank those candidates in app code with a composite score that folds in
 *      tier weight and the personalization boost.
 *   3. Paginate the re-ranked list ourselves.
 *
 * Because text relevance is multiplied by a large weight, it dominates when the
 * user typed a query; when `q` is empty every hit has the same relevance, so
 * tier weight + personalization + recency decide the order — i.e. "sorted by
 * relevance/visibility score" as the spec requires.
 */

/** Weight applied to Meili's 0..1 text-relevance score. Large so text match wins when a query is present. */
const RELEVANCE_WEIGHT = 1000;
/** Bonus added to packages whose agency the logged-in trekker has booked before. */
const PERSONALIZATION_BOOST = 40;
/** How many candidates to pull from Meili before re-ranking. Bounds worst-case work. */
const CANDIDATE_LIMIT = 1000;
/** Hard cap on page size so a caller can't request an unbounded page. */
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
  /** User id from a logged-in trekker's access token, if any. Drives personalization. */
  trekkerUserId?: string;
}

export interface MarketplaceSearchResult {
  data: PackageDocument[];
  meta: { total: number; page: number; limit: number; pages: number };
}

/** Strip characters that would break out of a Meilisearch quoted filter literal. */
function sanitizeFilterValue(value: string): string {
  return value.replace(/["\\]/g, "").trim();
}

/**
 * Find the set of agency ids a trekker has booked with before. Used to boost
 * those agencies in this trekker's marketplace results. Returns an empty set if
 * the user isn't a trekker / has no bookings — personalization is opt-in by login.
 */
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

  // Always-on gates: only published packages, never FREE-tier (hidden) agencies.
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

  // Personalization: which agencies has this trekker booked before?
  const boostedAgencies = params.trekkerUserId
    ? await bookedAgencyIdsFor(params.trekkerUserId)
    : new Set<string>();

  // Composite re-rank: text relevance (dominant) + tier weight + personalization + recency tiebreaker.
  const ranked = hits
    .map((hit) => {
      const relevance = (hit._rankingScore ?? 1) * RELEVANCE_WEIGHT;
      const personal = boostedAgencies.has(hit.agencyId) ? PERSONALIZATION_BOOST : 0;
      const recency = hit.createdAt / 1e10; // tiny: only breaks ties between otherwise-equal packages
      return { hit, score: relevance + (hit.tierWeight ?? 0) + personal + recency };
    })
    .sort((a, b) => b.score - a.score);

  const total = ranked.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = ranked.slice(start, start + limit).map(({ hit }) => {
    // drop the transient Meili-only field before returning to the client
    const { _rankingScore, ...doc } = hit;
    void _rankingScore;
    return doc as PackageDocument;
  });

  return { data, meta: { total, page, limit, pages } };
}
