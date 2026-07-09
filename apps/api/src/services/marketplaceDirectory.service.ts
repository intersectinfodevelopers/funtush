import { db } from "@funtush/database";

/**
 * ── Marketplace directory service (Week 3 · Day 3) ───────────────────────────
 *
 * Powers the PUBLIC, browse-by-hand surfaces of the central marketplace:
 *
 *   GET /marketplace/agencies            → agency directory (list)
 *   GET /marketplace/agencies/:slug      → one agency's public profile
 *   GET /marketplace/destinations        → destination directory (list)
 *   GET /marketplace/destinations/:slug  → one master destination page
 *
 * Why Postgres and not Meilisearch?
 * ─────────────────────────────────
 * Day 1/Day 2 routed *search* (a typed query + relevance ranking) through
 * Meilisearch — that's the right tool for fuzzy text matching. These Day 3
 * endpoints are *directory* pages: deterministic listings, aggregations
 * (rating averages, package counts) and joins across relational tables. That is
 * exactly what Postgres is good at, so we query Prisma directly. The Backend
 * Guide rule "search goes through Meilisearch" is about the search box, not
 * these browse pages.
 *
 * Marketplace visibility rule (Backend Guide §6 & §14)
 * ────────────────────────────────────────────────────
 * Only ACTIVE, non-FREE agencies are listed. Trial and Locked agencies are
 * explicitly "not listed" on the marketplace, and the FREE tier has
 * `features.marketplace = false`. Every query in this file therefore filters
 * through `LISTABLE_AGENCY` so we never leak a non-public agency.
 *
 * NOTE (flagged, not fixed here): per Core Concept Doc v1.1 Fix 1, the "Free
 * Tier" concept is eliminated — trial agencies are Small tier with
 * AgencyStatus.TRIAL, not a separate FREE tier. `status: "ACTIVE"` already
 * correctly excludes TRIAL/LOCKED agencies on its own; the `tier.name != FREE`
 * clause is legacy and harmless (additive), but should be removed once the
 * FREE tier is fully retired platform-wide.
 */

/**
 * Prisma `where` fragment for "an agency that may appear on the marketplace".
 * Reused by every query here so the visibility rule lives in exactly one place.
 */
export const LISTABLE_AGENCY = {
  status: "ACTIVE" as const,
  tier: { name: { not: "FREE" } },
};

/**
 * Turn a human destination name into a URL-safe slug.
 * "Everest Base Camp" → "everest-base-camp". Mirrors the package slug logic in
 * package.service.ts so the whole platform slugifies the same way.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // drop punctuation
    .replace(/\s+/g, "-"); // spaces → hyphens
}

/** Round a rating average to one decimal, or null when there are no reviews yet. */
export function roundRating(avg: number | null | undefined): number | null {
  return typeof avg === "number" ? Math.round(avg * 10) / 10 : null;
}

/* ── 1. Agency directory ─────────────────────────────────────────────────── */

export interface AgencyListItem {
  id: string;
  name: string;
  slug: string;
  tier: string;
  logo: string | null;
  description: string | null;
  rating: { average: number | null; count: number };
  topDestinations: string[];
  sponsored: boolean;
}

export interface AgencyDirectoryFilters {
  search?: string;
  tier?: string;
  region?: string;
  minRating?: number;
  page?: number;
  limit?: number;
}

export interface AgencyListResult {
  data: AgencyListItem[];
  meta: { total: number; page: number; limit: number; pages: number };
}


export async function listAgencies(filters: AgencyDirectoryFilters = {}): Promise<AgencyListResult> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(filters.limit ?? 20)));

  const where: Record<string, unknown> = { ...LISTABLE_AGENCY };
  if (filters.tier) {
    where.tier = { name: filters.tier };
  }
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { profile: { description: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const agencies = await db.agency.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      priorityOverride: true,
      tier: { select: { name: true } },
      profile: { select: { logo: true, description: true, regions: true } },
      destinations: {
        select: { name: true, _count: { select: { packages: true } } },
      },
    },
  });

  const ratings = await db.review.groupBy({
    by: ["agencyId"],
    _avg: { rating: true },
    _count: { rating: true },
  });
  const ratingByAgency = new Map(ratings.map((r) => [r.agencyId, r]));

  let mapped = agencies.map((a) => {
    const r = ratingByAgency.get(a.id);
    const topDestinations = [...a.destinations]
      .sort((x, y) => y._count.packages - x._count.packages)
      .slice(0, 5)
      .map((d) => d.name);

    const rawRegions = a.profile?.regions as unknown;
    const regions = Array.isArray(rawRegions)
      ? (rawRegions.filter((v) => typeof v === "string") as string[])
      : typeof rawRegions === "string"
        ? [rawRegions]
        : [];

    const item: AgencyListItem = {
      id: a.id,
      name: a.name,
      slug: a.slug,
      tier: a.tier.name,
      logo: a.profile?.logo ?? null,
      description: a.profile?.description ?? null,
      rating: { average: roundRating(r?._avg.rating), count: r?._count.rating ?? 0 },
      topDestinations,
      sponsored: a.priorityOverride > 0,
    };

    return { item, regions, ratingAverage: r?._avg.rating ?? null };
  });

  if (filters.region) {
    const needle = filters.region.toLowerCase();
    mapped = mapped.filter((m) => m.regions.some((r) => r.toLowerCase() === needle));
  }
  if (typeof filters.minRating === "number") {
    const minRating = filters.minRating;
    mapped = mapped.filter((m) => (m.ratingAverage ?? 0) >= minRating);
  }

  const total = mapped.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = mapped.slice(start, start + limit).map((m) => m.item);

  return { data, meta: { total, page, limit, pages } };
}

/* ── 2. Agency public profile ────────────────────────────────────────────── */

export async function getAgencyProfile(slug: string) {
  const agency = await db.agency.findFirst({
    where: { slug, ...LISTABLE_AGENCY },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      priorityOverride: true,
      tier: { select: { name: true } },
      kyc: { select: { status: true } },
      profile: {
        select: {
          logo: true,
          description: true,
          address: true,
          phone: true,
          email: true,
          regions: true,
          logoShowOnWebsite: true,
          descriptionShowOnWebsite: true,
          phoneShowOnWebsite: true,
          emailShowOnWebsite: true,
          regionsShowOnWebsite: true,
          addressShowOnWebsite: true,
        },
      },
      packages: {
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          durationDays: true,
          pricePerPerson: true,
          difficulty: true,
          destinations: { select: { name: true } },
        },
      },
      reviews: {
        where: { verified: true, flags: { none: { status: "REMOVED" } } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          rating: true,
          text: true,
          photos: true,
          createdAt: true,
          trekker: { select: { fullName: true } },
          response: { select: { responseText: true, respondedAt: true } },
        },
      },
    },
  });

  if (!agency) return null;

  const ratingAgg = await db.review.aggregate({
    where: { agencyId: agency.id, verified: true, flags: { none: { status: "REMOVED" } } },
    _avg: { rating: true },
    _count: { rating: true },
  });

  const averageRating = roundRating(ratingAgg._avg.rating);
  const reviewCount = ratingAgg._count.rating;

  const badges: string[] = [];
  if (agency.kyc?.status === "APPROVED") badges.push("Verified");
  if (averageRating !== null && averageRating >= 4.5 && reviewCount >= 5) badges.push("Top Rated");
  if (agency.priorityOverride > 0) badges.push("Sponsored");

  const p = agency.profile;
  return {
    id: agency.id,
    name: agency.name,
    slug: agency.slug,
    tier: agency.tier.name,
    memberSince: agency.createdAt,
    badges,
    profile: p
      ? {
          logo: p.logoShowOnWebsite ? p.logo : null,
          description: p.descriptionShowOnWebsite ? p.description : null,
          address: p.addressShowOnWebsite ? p.address : null,
          phone: p.phoneShowOnWebsite ? p.phone : null,
          email: p.emailShowOnWebsite ? p.email : null,
          regions: p.regionsShowOnWebsite ? p.regions : null,
        }
      : null,
    rating: { average: averageRating, count: reviewCount },
    packages: agency.packages.map((pkg) => ({
      id: pkg.id,
      title: pkg.title,
      slug: pkg.slug,
      description: pkg.description,
      durationDays: pkg.durationDays,
      pricePerPerson: Number(pkg.pricePerPerson),
      difficulty: pkg.difficulty,
      destinations: pkg.destinations.map((d) => d.name),
    })),
    reviews: agency.reviews.map((rev) => ({
      id: rev.id,
      rating: rev.rating,
      text: rev.text,
      photos: rev.photos,
      createdAt: rev.createdAt,
      trekkerName: rev.trekker?.fullName ?? "Anonymous",
      response: rev.response
        ? { text: rev.response.responseText, respondedAt: rev.response.respondedAt }
        : null,
    })),
  };
}

/* ── 3. Destination directory ────────────────────────────────────────────── */

export interface DestinationListItem {
  slug: string;
  name: string;
  region: string | null;
  altitudeM: number | null;
  bestSeason: string | null;
  packageCount: number;
  agencyCount: number;
}

export interface DestinationDirectoryFilters {
  region?: string;
  altitudeMin?: number;
  altitudeMax?: number;
  season?: string;
  page?: number;
  limit?: number;
}

export interface DestinationListResult {
  data: DestinationListItem[];
  meta: { total: number; page: number; limit: number; pages: number };
}

export async function listDestinations(
  filters: DestinationDirectoryFilters = {}
): Promise<DestinationListResult> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(filters.limit ?? 20)));

  const rows = await db.trekDestination.findMany({
    where: { agency: LISTABLE_AGENCY },
    select: {
      name: true,
      region: true,
      altitudeM: true,
      bestSeason: true,
      agencyId: true,
      packages: { where: { status: "PUBLISHED" }, select: { id: true } },
    },
  });

  const masters = new Map<
    string,
    {
      name: string;
      region: string | null;
      altitudeM: number | null;
      bestSeason: string | null;
      agencyIds: Set<string>;
      packageIds: Set<string>;
    }
  >();

  for (const row of rows) {
    const slug = slugify(row.name);
    if (!slug) continue;

    let master = masters.get(slug);
    if (!master) {
      master = {
        name: row.name,
        region: row.region,
        altitudeM: row.altitudeM,
        bestSeason: row.bestSeason,
        agencyIds: new Set(),
        packageIds: new Set(),
      };
      masters.set(slug, master);
    }
    master.region ??= row.region;
    master.altitudeM ??= row.altitudeM;
    master.bestSeason ??= row.bestSeason;
    master.agencyIds.add(row.agencyId);
    for (const pkg of row.packages) master.packageIds.add(pkg.id);
  }

  let items: DestinationListItem[] = [...masters.entries()].map(([slug, m]) => ({
    slug,
    name: m.name,
    region: m.region,
    altitudeM: m.altitudeM,
    bestSeason: m.bestSeason,
    packageCount: m.packageIds.size,
    agencyCount: m.agencyIds.size,
  }));

  if (filters.region) {
    const needle = filters.region.toLowerCase();
    items = items.filter((d) => d.region?.toLowerCase() === needle);
  }
  if (typeof filters.altitudeMin === "number") {
    const min = filters.altitudeMin;
    items = items.filter((d) => d.altitudeM !== null && d.altitudeM >= min);
  }
  if (typeof filters.altitudeMax === "number") {
    const max = filters.altitudeMax;
    items = items.filter((d) => d.altitudeM !== null && d.altitudeM <= max);
  }
  if (filters.season) {
    const needle = filters.season.toLowerCase();
    items = items.filter((d) => d.bestSeason?.toLowerCase() === needle);
  }

  items.sort((a, b) => b.packageCount - a.packageCount || a.name.localeCompare(b.name));

  const total = items.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = items.slice(start, start + limit);

  return { data, meta: { total, page, limit, pages } };
}

/* ── 4. Master destination page ──────────────────────────────────────────── */

export async function getDestinationBySlug(slug: string) {
  const rows = await db.trekDestination.findMany({
    where: { agency: LISTABLE_AGENCY },
    select: {
      name: true,
      region: true,
      altitudeM: true,
      bestSeason: true,
      agency: {
        select: {
          id: true,
          name: true,
          slug: true,
          tier: { select: { name: true } },
        },
      },
      packages: {
        where: { status: "PUBLISHED" },
        select: {
          id: true,
          title: true,
          slug: true,
          durationDays: true,
          pricePerPerson: true,
          difficulty: true,
          agencyId: true,
        },
      },
    },
  });

  const matching = rows.filter((row) => slugify(row.name) === slug);
  if (matching.length === 0) return null;

  let name = matching[0].name;
  let region: string | null = null;
  let altitudeM: number | null = null;
  let bestSeason: string | null = null;

  const agencyMap = new Map<
    string,
    {
      id: string;
      name: string;
      slug: string;
      tier: string;
      packages: {
        id: string;
        title: string;
        slug: string;
        durationDays: number;
        pricePerPerson: number;
        difficulty: string;
      }[];
    }
  >();

  for (const row of matching) {
    name = row.name || name;
    region ??= row.region;
    altitudeM ??= row.altitudeM;
    bestSeason ??= row.bestSeason;

    const a = row.agency;
    let entry = agencyMap.get(a.id);
    if (!entry) {
      entry = { id: a.id, name: a.name, slug: a.slug, tier: a.tier.name, packages: [] };
      agencyMap.set(a.id, entry);
    }
    for (const pkg of row.packages) {
      entry.packages.push({
        id: pkg.id,
        title: pkg.title,
        slug: pkg.slug,
        durationDays: pkg.durationDays,
        pricePerPerson: Number(pkg.pricePerPerson),
        difficulty: pkg.difficulty,
      });
    }
  }

  const agencies = [...agencyMap.values()].filter((a) => a.packages.length > 0);
  const packageCount = agencies.reduce((sum, a) => sum + a.packages.length, 0);

  return {
    slug,
    name,
    region,
    altitudeM,
    bestSeason,
    agencyCount: agencies.length,
    packageCount,
    agencies,
  };
}