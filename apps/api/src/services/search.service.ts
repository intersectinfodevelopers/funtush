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
      filterableAttributes: ["difficulty", "price", "duration", "season", "altitude", "status", "agencyId"],
      sortableAttributes: ["price", "duration", "altitude", "createdAt"],
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
  agency: { name: string };
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
        agency: { select: { name: true } },
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
