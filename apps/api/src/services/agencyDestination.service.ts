import { db, Prisma } from "@funtush/database";
import { notifyTrekker } from "./notification.service";
import { hiddenCustomerKeys } from "./agencyCustomerRecords.service";

/**
 * Agency Destinations — the curated marketing "destination" pages for an
 * agency's white-label site. API shape follows funtush-frontend's
 * DestinationForm + the list page (nested `duration`/`altitude`/`engagement`).
 */

export class AgencyDestinationError extends Error {
  status: number;
  /** The input this message belongs to, so the dashboard can show it under that field. */
  field?: string;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export const DESTINATION_CATEGORIES = ["Trekking", "Peak Climbing", "Cultural", "Wildlife", "Adventure", "Pilgrimage"] as const;
export const DESTINATION_DIFFICULTIES = ["Easy", "Moderate", "Challenging", "Difficult"] as const;

const bad = (field: string, message: string) => new AgencyDestinationError(400, message, field);

/** Field-by-field checks (same rules for create and update); only keys that are present are checked. */
function validateInput(b: DestinationInput): void {
  const text = (v: unknown, field: string, label: string, max: number) => {
    if (v === undefined || v === null) return;
    if (typeof v !== "string") throw bad(field, `${label} must be text.`);
    if (v.trim().length > max) throw bad(field, `${label} must be at most ${max} characters.`);
  };
  if (b.title !== undefined) {
    if (typeof b.title !== "string" || !b.title.trim()) throw bad("title", "Destination name is required.");
    text(b.title, "title", "Destination name", 150);
  }
  text(b.shortDescription, "shortDescription", "Short description", 300);
  text(b.longDescription, "longDescription", "Long description", 8000);
  text(b.region, "region", "Region", 120);
  text(b.bestTimeToVisit ?? b.bestSeason, "bestTimeToVisit", "Best time to visit", 120);
  text(b.category, "category", "Category", 60);
  text(b.difficulty, "difficulty", "Difficulty", 40);
  if (b.activities !== undefined) {
    if (!Array.isArray(b.activities) || b.activities.length > 20) throw bad("activities", "Add at most 20 activities.");
    for (const a of b.activities) if (typeof a !== "string" || !a.trim() || a.trim().length > 40) throw bad("activities", "Each activity must be 1–40 characters.");
  }
  const whole = (v: unknown, field: string, label: string, max: number) => {
    if (v === undefined || v === null || v === "") return null;
    // lenient like the saver itself: "5,364m" means 5364
    const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d-]/g, ""), 10);
    if (!Number.isInteger(n) || n < 0 || n > max) throw bad(field, `${label} must be a whole number between 0 and ${max}.`);
    return n;
  };
  const dMin = whole(b.durationMin, "durationMin", "Minimum days", 365);
  const dMax = whole(b.durationMax, "durationMax", "Maximum days", 365);
  const aMin = whole(b.altitudeMin, "altitudeMin", "Minimum altitude", 9000);
  const aMax = whole(b.altitudeMax, "altitudeMax", "Maximum altitude", 9000);
  if (dMin != null && dMax != null && dMin > dMax) throw bad("durationMin", "Minimum days can't be more than the maximum.");
  if (aMin != null && aMax != null && aMin > aMax) throw bad("altitudeMin", "Minimum altitude can't be more than the maximum.");
  if (b.gallery !== undefined && (!Array.isArray(b.gallery) || b.gallery.length > 12)) throw bad("gallery", "A destination can have at most 12 gallery images.");
}

/** What a destination needs before it can go live on the agency's site. */
function publishGaps(d: { title?: string | null; shortDescription?: string | null; featuredImage?: string | null }): string[] {
  const gaps: string[] = [];
  if (!d.title?.trim()) gaps.push("a name");
  if (!d.shortDescription?.trim()) gaps.push("a short description");
  if (!d.featuredImage) gaps.push("a featured image");
  return gaps;
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

/** Media URLs end up in <img>/CSS on public sites: only http(s) is acceptable (no javascript:/data: URLs). */
function cleanUrl(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v !== "string") throw new AgencyDestinationError(400, `${field} must be a URL.`, field);
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    return u.toString();
  } catch {
    throw new AgencyDestinationError(400, `${field} must be a valid http(s) URL.`, field);
  }
}
function cleanUrls(v: unknown, field: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new AgencyDestinationError(400, `${field} must be a list of URLs.`, field);
  return v.map((u) => cleanUrl(u, field)).filter((u): u is string => typeof u === "string");
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
  // Whole-agency numbers for the cards on the destinations page (not affected by the search / filters above).
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [everyone, published, featured, regionRows, totalBeforeMonth] = await Promise.all([
    db.agencyDestination.count({ where: { agencyId } }),
    db.agencyDestination.count({ where: { agencyId, published: true } }),
    db.agencyDestination.count({ where: { agencyId, featured: true } }),
    db.agencyDestination.findMany({ where: { agencyId, region: { not: null } }, select: { region: true }, distinct: ["region"] }),
    db.agencyDestination.count({ where: { agencyId, createdAt: { lt: monthStart } } }),
  ]);
  const regions = new Set(regionRows.map((r) => r.region!.trim().toLowerCase()).filter(Boolean)).size;

  return { destinations: rows.map(toApi), total, page, limit, stats: { total: everyone, published, featured, regions, totalBeforeMonth }, categories: [...DESTINATION_CATEGORIES] };
}

/**
 * Tell the agency's customers (travellers with a Funtush account who booked with it — in the app inbox and as a push)
 * that a new destination is live. Happens ONCE per destination, the first time it is published; customers the agency
 * removed from its list are skipped. Never throws: the destination is already saved.
 */
async function announceDestination(agencyId: string, destinationId: string): Promise<void> {
  try {
    const claimed = await db.agencyDestination.updateMany({ where: { id: destinationId, agencyId, published: true, announcedAt: null }, data: { announcedAt: new Date() } });
    if (claimed.count === 0) return; // not published, or already announced
    const [dest, agency, hidden, rows] = await Promise.all([
      db.agencyDestination.findUnique({ where: { id: destinationId }, select: { title: true, slug: true, region: true, shortDescription: true } }),
      db.agency.findUnique({ where: { id: agencyId }, select: { name: true, slug: true } }),
      hiddenCustomerKeys(agencyId),
      db.booking.findMany({ where: { agencyId, trekkerId: { not: null } }, distinct: ["trekkerId"], select: { trekkerId: true }, take: 5000 }),
    ]);
    if (!dest || !agency) return;
    const audience = rows.map((r) => r.trekkerId as string).filter((id) => !hidden.has(id));
    const body = (dest.shortDescription?.trim() || (dest.region ? `Now exploring ${dest.region}` : "Take a look and plan your next trek")).slice(0, 200);
    for (const trekkerId of audience) {
      try {
        await notifyTrekker(trekkerId, {
          title: `New destination from ${agency.name}: ${dest.title}`,
          body,
          data: { type: "NEW_DESTINATION", destinationId, destinationSlug: dest.slug, agencySlug: agency.slug ?? "", link: `/site/${agency.slug ?? ""}/destinations/${dest.slug}` },
        });
      } catch (err) {
        console.error("[destination announce]", (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[destination announce]", (err as Error).message);
  }
}

export async function createDestination(agencyId: string, body: DestinationInput) {
  const title = (body.title ?? "").trim();
  if (!title) throw bad("title", "Destination name is required.");
  validateInput(body);
  if (body.published) {
    const gaps = publishGaps({ title, shortDescription: body.shortDescription, featuredImage: cleanUrl(body.featuredImage, "featuredImage") });
    if (gaps.length) throw bad("publish", `This destination can't be published yet. Please add: ${gaps.join(", ")}.`);
  }
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
      featuredImage: cleanUrl(body.featuredImage, "featuredImage") ?? null,
      gallery: cleanUrls(body.gallery, "gallery") ?? [],
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
  if (row.published) void announceDestination(agencyId, row.id);
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
    select: { id: true, title: true, shortDescription: true, featuredImage: true, published: true },
  });
  if (!existing) throw new AgencyDestinationError(404, "Destination not found.");
  validateInput(body);
  // What the destination will look like after this edit — a live one must keep what it needs to be live.
  const willBePublished = body.published ?? existing.published;
  if (willBePublished) {
    const gaps = publishGaps({
      title: body.title ?? existing.title,
      shortDescription: body.shortDescription !== undefined ? body.shortDescription : existing.shortDescription,
      featuredImage: body.featuredImage !== undefined ? cleanUrl(body.featuredImage, "featuredImage") : existing.featuredImage,
    });
    if (gaps.length) throw bad("publish", `This destination can't be published yet. Please add: ${gaps.join(", ")}.`);
  }

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
  if (body.featuredImage !== undefined) data.featuredImage = cleanUrl(body.featuredImage, "featuredImage");
  if (body.gallery !== undefined) data.gallery = cleanUrls(body.gallery, "gallery") ?? [];
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
  if (row.published) void announceDestination(agencyId, id);
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
