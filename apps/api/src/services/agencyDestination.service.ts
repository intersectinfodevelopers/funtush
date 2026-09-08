import { db, Prisma } from "@funtush/database";

/**
 * Agency Destinations — the curated marketing "destination" pages for an
 * agency's white-label site. API shape follows funtush-frontend's
 * DestinationForm + the list page (nested `duration`/`altitude`/`engagement`).
 */

export class AgencyDestinationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uniqueSlug(agencyId: string, base: string, ignoreId?: string): Promise<string> {
  const root = slugify(base) || "destination";
  let slug = root;
  let n = 1;
  for (;;) {
    const hit = await db.agencyDestination.findFirst({
      where: { agencyId, slug },
      select: { id: true },
    });
    if (!hit || hit.id === ignoreId) return slug;
    n += 1;
    slug = `${root}-${n}`;
  }
}

const SELECT = {
  id: true,
  title: true,
  slug: true,
  category: true,
  shortDescription: true,
  longDescription: true,
  region: true,
  difficulty: true,
  activities: true,
  featuredImage: true,
  gallery: true,
  durationMinDays: true,
  durationMaxDays: true,
  altitudeMinM: true,
  altitudeMaxM: true,
  bestTimeToVisit: true,
  published: true,
  featured: true,
  rating: true,
  reviewCount: true,
  views: true,
  saves: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgencyDestinationSelect;

type Row = Prisma.AgencyDestinationGetPayload<{ select: typeof SELECT }>;

function toApi(r: Row) {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    category: r.category,
    shortDescription: r.shortDescription,
    longDescription: r.longDescription,
    region: r.region,
    difficulty: r.difficulty,
    activities: r.activities,
    featuredImage: r.featuredImage,
    gallery: r.gallery,
    // flat (form) …
    durationMin: r.durationMinDays,
    durationMax: r.durationMaxDays,
    altitudeMin: r.altitudeMinM,
    altitudeMax: r.altitudeMaxM,
    // … and nested (list page)
    duration: { min: r.durationMinDays, max: r.durationMaxDays },
    altitude: { min: r.altitudeMinM, max: r.altitudeMaxM },
    engagement: { views: r.views, saves: r.saves },
    bestTimeToVisit: r.bestTimeToVisit,
    bestSeason: r.bestTimeToVisit,
    published: r.published,
    featured: r.featured,
    rating: r.rating === null ? null : Number(r.rating),
    reviewCount: r.reviewCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function intOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

export interface DestinationInput {
  title?: string;
  slug?: string;
  category?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  region?: string | null;
  difficulty?: string | null;
  activities?: string[];
  featuredImage?: string | null;
  gallery?: string[];
  durationMin?: number | string | null;
  durationMax?: number | string | null;
  altitudeMin?: number | string | null;
  altitudeMax?: number | string | null;
  bestTimeToVisit?: string | null;
  bestSeason?: string | null;
  published?: boolean;
  featured?: boolean;
}

export async function listDestinations(
  agencyId: string,
  q: { published?: string; featured?: string; category?: string; search?: string; page?: number; limit?: number } = {},
) {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const where: Prisma.AgencyDestinationWhereInput = { agencyId };
  if (q.published === "true") where.published = true;
  if (q.published === "false") where.published = false;
  if (q.featured === "true") where.featured = true;
  if (q.category && q.category.toLowerCase() !== "all") where.category = q.category;
  if (q.search?.trim()) {
    where.OR = [
      { title: { contains: q.search.trim(), mode: "insensitive" } },
      { region: { contains: q.search.trim(), mode: "insensitive" } },
      { shortDescription: { contains: q.search.trim(), mode: "insensitive" } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.agencyDestination.findMany({
      where,
      select: SELECT,
      orderBy: { title: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.agencyDestination.count({ where }),
  ]);
  return { destinations: rows.map(toApi), total, page, limit };
}

export async function createDestination(agencyId: string, body: DestinationInput) {
  const title = (body.title ?? "").trim();
  if (!title) throw new AgencyDestinationError(400, "Destination title is required.");
  const slug = await uniqueSlug(agencyId, body.slug?.trim() || title);

  const row = await db.agencyDestination.create({
    data: {
      agencyId,
      title,
      slug,
      category: body.category?.trim() || null,
      shortDescription: body.shortDescription?.trim() || null,
      longDescription: body.longDescription ?? null,
      region: body.region?.trim() || null,
      difficulty: body.difficulty?.trim() || null,
      activities: body.activities ?? [],
      featuredImage: body.featuredImage?.trim() || null,
      gallery: body.gallery ?? [],
      durationMinDays: intOrNull(body.durationMin) ?? null,
      durationMaxDays: intOrNull(body.durationMax) ?? null,
      altitudeMinM: intOrNull(body.altitudeMin) ?? null,
      altitudeMaxM: intOrNull(body.altitudeMax) ?? null,
      bestTimeToVisit: (body.bestTimeToVisit ?? body.bestSeason)?.trim() || null,
      published: body.published ?? false,
      featured: body.featured ?? false,
    },
    select: SELECT,
  });
  return toApi(row);
}

export async function getDestination(agencyId: string, id: string) {
  const row = await db.agencyDestination.findFirst({ where: { id, agencyId }, select: SELECT });
  if (!row) throw new AgencyDestinationError(404, "Destination not found.");
  return toApi(row);
}

export async function updateDestination(agencyId: string, id: string, body: DestinationInput) {
  const existing = await db.agencyDestination.findFirst({
    where: { id, agencyId },
    select: { id: true },
  });
  if (!existing) throw new AgencyDestinationError(404, "Destination not found.");

  const data: Prisma.AgencyDestinationUpdateInput = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) throw new AgencyDestinationError(400, "Title cannot be empty.");
    data.title = t;
  }
  if (body.slug !== undefined || body.title !== undefined) {
    data.slug = await uniqueSlug(agencyId, body.slug?.trim() || body.title?.trim() || "", id);
  }
  if (body.category !== undefined) data.category = body.category?.trim() || null;
  if (body.shortDescription !== undefined) data.shortDescription = body.shortDescription?.trim() || null;
  if (body.longDescription !== undefined) data.longDescription = body.longDescription ?? null;
  if (body.region !== undefined) data.region = body.region?.trim() || null;
  if (body.difficulty !== undefined) data.difficulty = body.difficulty?.trim() || null;
  if (body.activities !== undefined) data.activities = body.activities ?? [];
  if (body.featuredImage !== undefined) data.featuredImage = body.featuredImage?.trim() || null;
  if (body.gallery !== undefined) data.gallery = body.gallery ?? [];
  const dMin = intOrNull(body.durationMin);
  if (dMin !== undefined) data.durationMinDays = dMin;
  const dMax = intOrNull(body.durationMax);
  if (dMax !== undefined) data.durationMaxDays = dMax;
  const aMin = intOrNull(body.altitudeMin);
  if (aMin !== undefined) data.altitudeMinM = aMin;
  const aMax = intOrNull(body.altitudeMax);
  if (aMax !== undefined) data.altitudeMaxM = aMax;
  if (body.bestTimeToVisit !== undefined || body.bestSeason !== undefined) {
    data.bestTimeToVisit = (body.bestTimeToVisit ?? body.bestSeason)?.trim() || null;
  }
  if (body.published !== undefined) data.published = body.published;
  if (body.featured !== undefined) data.featured = body.featured;

  const row = await db.agencyDestination.update({ where: { id }, data, select: SELECT });
  return toApi(row);
}

export async function deleteDestination(agencyId: string, id: string) {
  const existing = await db.agencyDestination.findFirst({
    where: { id, agencyId },
    select: { id: true },
  });
  if (!existing) throw new AgencyDestinationError(404, "Destination not found.");
  await db.agencyDestination.delete({ where: { id } });
}
