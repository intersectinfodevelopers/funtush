import { cacheGet, cacheSet } from "./redis.service.js";
import { db } from "@funtush/database";
import { sanitizeRichText } from "../lib/sanitizeHtml";

/**
 * Public content for an agency's white-label site: packages, destinations, blog, gallery, videos,
 * reviews, ads. Everything is read-only, scoped to ONE agency (resolved from the site slug), limited to
 * what the agency published, and exposes only fields a visitor may see (no ids of staff/guides, no
 * internal statuses, no other agencies' data).
 */
export class SiteContentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function agencyIdForSlug(slug: string): Promise<{ id: string; name: string }> {
  const a = await db.agency.findUnique({ where: { slug: slug.toLowerCase() }, select: { id: true, name: true } });
  if (!a) throw new SiteContentError(404, "Site not found");
  return a;
}

const clampLimit = (n: unknown, def: number, max: number) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, max) : def;
};

const PACKAGE_CARD = {
  id: true,
  slug: true,
  title: true,
  description: true,
  durationDays: true,
  pricePerPerson: true,
  difficulty: true,
  maxGroupSize: true,
  photos: true,
  shortSummary: true,
  category: true,
  region: true,
  destination: true,
  currency: true,
  isFeatured: true,
} as const;

export async function listSitePackages(agencyId: string, q: { search?: string; limit?: unknown } = {}) {
  const search = typeof q.search === "string" ? q.search.trim().slice(0, 80) : "";
  const rows = await db.trekPackage.findMany({
    where: {
      agencyId,
      status: "PUBLISHED",
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}),
    },
    select: {
      ...PACKAGE_CARD,
      departureDates: { where: { startDate: { gte: new Date() }, status: { not: "FULL" } }, orderBy: { startDate: "asc" }, take: 1, select: { startDate: true } },
    },
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    take: clampLimit(q.limit, 50, 100),
  });
  return rows.map(({ departureDates, ...p }) => ({ ...p, pricePerPerson: Number(p.pricePerPerson), nextDeparture: departureDates[0]?.startDate ?? null }));
}

export async function getSitePackage(agencyId: string, idOrSlug: string) {
  const p = await db.trekPackage.findFirst({
    where: { agencyId, status: "PUBLISHED", OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      ...PACKAGE_CARD,
      activities: true,
      routes: true,
      bestTimeToVisit: true,
      altitudeMinM: true,
      altitudeMaxM: true,
      minDurationDays: true,
      maxDurationDays: true,
      volumeDiscounts: true,
      itineraries: { orderBy: { dayNumber: "asc" }, select: { dayNumber: true, location: true, description: true, altitudeM: true } },
      departureDates: { where: { startDate: { gte: new Date() }, status: { not: "FULL" } }, orderBy: { startDate: "asc" }, take: 24, select: { id: true, startDate: true, maxSlots: true, bookedSlots: true, status: true } },
      addOns: { select: { id: true, name: true, price: true, perPerson: true } },
    },
  });
  if (!p) throw new SiteContentError(404, "Package not found");
  const { departureDates, addOns, ...rest } = p;
  return {
    ...rest,
    pricePerPerson: Number(p.pricePerPerson),
    departures: departureDates.map((d) => ({ id: d.id, startDate: d.startDate, seatsLeft: Math.max(0, d.maxSlots - d.bookedSlots), status: d.status })).filter((d) => d.seatsLeft > 0),
    addOns: addOns.map((a) => ({ ...a, price: Number(a.price) })),
  };
}

const DEST_CARD = {
  id: true, slug: true, title: true, category: true, shortDescription: true, region: true, difficulty: true, featuredImage: true,
  durationMinDays: true, durationMaxDays: true, altitudeMinM: true, altitudeMaxM: true, featured: true, rating: true, reviewCount: true,
} as const;

export async function listSiteDestinations(agencyId: string, q: { featured?: unknown; limit?: unknown } = {}) {
  const rows = await db.agencyDestination.findMany({
    where: { agencyId, published: true, ...(q.featured === "true" ? { featured: true } : {}) },
    select: DEST_CARD,
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    take: clampLimit(q.limit, 50, 100),
  });
  return rows.map((r) => ({ ...r, rating: r.rating === null ? null : Number(r.rating) }));
}

export async function getSiteDestination(agencyId: string, slug: string) {
  const r = await db.agencyDestination.findFirst({
    where: { agencyId, published: true, slug },
    select: { ...DEST_CARD, longDescription: true, activities: true, gallery: true, bestTimeToVisit: true },
  });
  if (!r) throw new SiteContentError(404, "Destination not found");
  return { ...r, rating: r.rating === null ? null : Number(r.rating) };
}

export async function listSiteBlogs(agencyId: string, q: { limit?: unknown } = {}) {
  return db.blog.findMany({
    where: { agencyId, status: "PUBLISHED" },
    select: { id: true, title: true, subtitle: true, tags: true, photos: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: clampLimit(q.limit, 20, 50),
  });
}

export async function getSiteBlog(agencyId: string, id: string) {
  const b = await db.blog.findFirst({
    where: { agencyId, status: "PUBLISHED", id },
    // `content` is sanitised HTML — cleaned at write time (sanitizeRichText), safe to render as HTML.
    select: { id: true, title: true, subtitle: true, tags: true, photos: true, content: true, createdAt: true },
  });
  if (!b) throw new SiteContentError(404, "Post not found");
  // Sanitised again on the way OUT: a post written before write-time sanitising existed must not be trusted.
  return { ...b, content: sanitizeRichText(b.content) };
}

const VIEW_DEDUPE_SECONDS = 30 * 60;

/** Counts one visit to a published blog post. The same visitor (IP) reopening it within 30 minutes
 * isn't counted twice — same dedupe scheme as recordDestinationView. */
export async function recordBlogView(agencyId: string, id: string, visitor: string) {
  const b = await db.blog.findFirst({ where: { agencyId, status: "PUBLISHED", id }, select: { id: true } });
  if (!b) throw new SiteContentError(404, "Post not found");
  const key = `blog-view:${b.id}:${visitor}`;
  if (await cacheGet(key)) return { counted: false };
  await cacheSet(key, true, VIEW_DEDUPE_SECONDS);
  await db.blog.update({ where: { id: b.id }, data: { views: { increment: 1 } } });
  return { counted: true };
}

export async function listSiteGallery(agencyId: string) {
  return db.galleryPost.findMany({
    where: { agencyId, status: "PUBLISHED" },
    select: { id: true, title: true, description: true, category: true, images: true, featuredImage: true },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    take: 50,
  });
}

export async function listSiteVideos(agencyId: string) {
  return db.video.findMany({
    where: { agencyId, status: "ACTIVE" },
    select: { id: true, title: true, description: true, youtubeUrl: true, thumbnailUrl: true },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    take: 50,
  });
}

export async function listSiteReviews(agencyId: string, q: { limit?: unknown } = {}) {
  const rows = await db.review.findMany({
    // A review an admin removed after a flag must never surface on the agency's site.
    where: { agencyId, flags: { none: { status: "REMOVED" } } },
    select: { id: true, rating: true, title: true, text: true, createdAt: true, trekker: { select: { fullName: true, country: true } }, response: { select: { responseText: true } } },
    orderBy: { createdAt: "desc" },
    take: clampLimit(q.limit, 12, 50),
  });
  const agg = await db.review.aggregate({ where: { agencyId, flags: { none: { status: "REMOVED" } } }, _avg: { rating: true }, _count: true });
  return {
    average: agg._avg.rating === null ? null : Math.round(agg._avg.rating * 10) / 10,
    count: agg._count,
    reviews: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      text: r.text,
      createdAt: r.createdAt,
      // First name only — a public page never shows a trekker's full name.
      author: r.trekker?.fullName ? r.trekker.fullName.trim().split(/\s+/)[0] : "Trekker",
      country: r.trekker?.country ?? null,
      reply: r.response?.responseText ?? null,
    })),
  };
}

export async function listSiteAds(agencyId: string, position?: unknown) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  return db.siteAd.findMany({
    where: {
      agencyId,
      status: "ACTIVE",
      ...(typeof position === "string" && position ? { position } : {}),
      AND: [{ OR: [{ startDate: null }, { startDate: { lte: today } }] }, { OR: [{ endDate: null }, { endDate: { gte: today } }] }],
    },
    select: { id: true, title: true, imageUrl: true, linkUrl: true, position: true },
    orderBy: [{ position: "asc" }, { order: "asc" }],
    take: 20,
  });
}

/** Contact/about details the agency chose to show. Each field honours its own "show on website" flag. */
export async function getSiteAbout(agencyId: string) {
  const [agency, p] = await Promise.all([
    db.agency.findUnique({ where: { id: agencyId }, select: { name: true } }),
    db.agencyProfile.findUnique({
      where: { agencyId },
      select: {
        description: true, descriptionShowOnWebsite: true, address: true, addressShowOnWebsite: true,
        phone: true, phoneShowOnWebsite: true, email: true, emailShowOnWebsite: true, regions: true, regionsShowOnWebsite: true,
      },
    }),
  ]);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    name: agency?.name ?? "",
    description: p && p.descriptionShowOnWebsite ? p.description : null,
    address: p && p.addressShowOnWebsite ? p.address : null,
    phones: p && p.phoneShowOnWebsite ? list(p.phone) : [],
    emails: p && p.emailShowOnWebsite ? list(p.email) : [],
    regions: p && p.regionsShowOnWebsite ? list(p.regions) : [],
  };
}

/** Counts one view of a published destination; the same visitor (`viewer`) is counted once per 30 minutes. */
export async function recordDestinationView(agencyId: string, slug: string, viewer: string) {
  const d = await db.agencyDestination.findFirst({ where: { agencyId, published: true, slug }, select: { id: true } });
  if (!d) throw new SiteContentError(404, "Destination not found");
  const key = `dest-view:${d.id}:${viewer}`;
  if (await cacheGet<boolean>(key)) return { counted: false };
  await cacheSet(key, true, 30 * 60);
  await db.agencyDestination.update({ where: { id: d.id }, data: { views: { increment: 1 } } });
  return { counted: true };
}
