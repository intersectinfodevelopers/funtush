import { db, Prisma } from "@funtush/database";

/**
 * Site ads — banner ads in fixed slots on the agency's white-label site.
 * API shape follows funtush-frontend/data/advertisements.json (status lowercased,
 * `image` ↔ imageUrl). `linkUrl` is an upgrade — the mock form doesn't capture it.
 */

export class SiteAdError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Known placement slots on the white-label site. */
export const AD_POSITIONS = [
  { id: "popup-ads", label: "Popup Ads" },
  { id: "top-ads", label: "Top Ads" },
  { id: "inside-blog", label: "Inside Blog" },
  { id: "inside-video", label: "Inside Video" },
  { id: "inside-gallery", label: "Inside Gallery" },
  { id: "inside-destination", label: "Inside Destination" },
  { id: "inside-packages", label: "Inside Packages" },
] as const;

const SELECT = {
  id: true,
  title: true,
  imageUrl: true,
  linkUrl: true,
  position: true,
  status: true,
  clicks: true,
  impressions: true,
  startDate: true,
  endDate: true,
  order: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SiteAdSelect;

type Row = Prisma.SiteAdGetPayload<{ select: typeof SELECT }>;

function ymd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toApi(r: Row) {
  return {
    id: r.id,
    title: r.title,
    image: r.imageUrl,
    linkUrl: r.linkUrl,
    position: r.position,
    status: r.status.toLowerCase(),
    clicks: r.clicks,
    impressions: r.impressions,
    startDate: ymd(r.startDate),
    endDate: ymd(r.endDate),
    order: r.order,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function dbStatus(s: string | undefined): "ACTIVE" | "PAUSED" | undefined {
  if (s === undefined) return undefined;
  return s.toLowerCase() === "paused" ? "PAUSED" : "ACTIVE";
}
function toDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = typeof v === "string" ? new Date(v) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw new SiteAdError(400, "Invalid date.");
  return d;
}

/**
 * Ad image/link are rendered as <img src>/<a href> on the public site: http(s) or a
 * site-relative path ("/x", never "//host" or "/\\host") only.
 */
function httpUrl(v: unknown, label: string): string {
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\/(?![/\\])[^\s]*$/.test(t)) return t;
    try {
      const u = new URL(v.trim());
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch {
      /* fall through */
    }
  }
  throw new SiteAdError(400, `${label} must be a valid http(s) URL.`);
}

function validPosition(v: unknown): string {
  const p = typeof v === "string" ? v.trim() : "";
  if (!p) throw new SiteAdError(400, "A placement position is required.");
  if (!AD_POSITIONS.some((x) => x.id === p)) throw new SiteAdError(400, "Unknown ad position.");
  return p;
}

function validOrder(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100000) {
    throw new SiteAdError(400, "Order must be a whole number, 0 or more.");
  }
  return v;
}

function checkRange(start: Date | null | undefined, end: Date | null | undefined) {
  if (start && end && start > end) throw new SiteAdError(400, "The end date must be on or after the start date.");
}

export interface SiteAdInput {
  title?: string;
  image?: string;
  linkUrl?: string | null;
  position?: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  order?: number;
}

export async function listSiteAds(
  agencyId: string,
  q: { status?: string; position?: string; search?: string; page?: number; limit?: number } = {},
) {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const where: Prisma.SiteAdWhereInput = { agencyId };
  if (q.status && q.status.toLowerCase() !== "all") where.status = dbStatus(q.status);
  if (q.search?.trim()) where.title = { contains: q.search.trim(), mode: "insensitive" };
  if (q.position && q.position.toLowerCase() !== "all") where.position = q.position;

  // Stats are over ALL of the agency's ads (ignoring the search/status/position filters), not just this page.
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [rows, total, statsTotal, statsActive, totals, totalBeforeMonth] = await Promise.all([
    db.siteAd.findMany({
      where,
      select: SELECT,
      orderBy: [{ position: "asc" }, { order: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.siteAd.count({ where }),
    db.siteAd.count({ where: { agencyId } }),
    db.siteAd.count({ where: { agencyId, status: "ACTIVE" } }),
    db.siteAd.aggregate({ where: { agencyId }, _sum: { clicks: true, impressions: true } }),
    db.siteAd.count({ where: { agencyId, createdAt: { lt: startOfMonth } } }),
  ]);
  return {
    ads: rows.map(toApi),
    total,
    page,
    limit,
    stats: {
      total: statsTotal,
      active: statsActive,
      paused: statsTotal - statsActive,
      totalClicks: totals._sum.clicks ?? 0,
      totalImpressions: totals._sum.impressions ?? 0,
      totalBeforeMonth,
    },
  };
}

/** The known slots plus how many active ads currently fill each. */
export async function listPositions(agencyId: string) {
  const counts = await db.siteAd.groupBy({
    by: ["position"],
    where: { agencyId, status: "ACTIVE" },
    _count: { _all: true },
  });
  const map = new Map(counts.map((c) => [c.position, c._count._all]));
  return AD_POSITIONS.map((p) => ({
    id: p.id,
    label: p.label,
    activeAds: map.get(p.id) ?? 0,
    available: (map.get(p.id) ?? 0) === 0,
  }));
}

export async function createSiteAd(agencyId: string, body: SiteAdInput) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new SiteAdError(400, "Ad title is required.");
  if (title.length > 120) throw new SiteAdError(400, "Ad title is too long (max 120 characters).");
  if (body.image === undefined || body.image === "") throw new SiteAdError(400, "An ad image is required.");
  const image = httpUrl(body.image, "Ad image");
  const position = validPosition(body.position);
  const startDate = toDate(body.startDate) ?? null;
  const endDate = toDate(body.endDate) ?? null;
  checkRange(startDate, endDate);

  const row = await db.siteAd.create({
    data: {
      agencyId,
      title,
      imageUrl: image,
      linkUrl: body.linkUrl ? httpUrl(body.linkUrl, "Link") : null,
      position,
      status: dbStatus(body.status) ?? "ACTIVE",
      startDate,
      endDate,
      order: validOrder(body.order) ?? 0,
    },
    select: SELECT,
  });
  return toApi(row);
}

export async function getSiteAd(agencyId: string, id: string) {
  const row = await db.siteAd.findFirst({ where: { id, agencyId }, select: SELECT });
  if (!row) throw new SiteAdError(404, "Ad not found.");
  return toApi(row);
}

export async function updateSiteAd(agencyId: string, id: string, body: SiteAdInput) {
  const existing = await db.siteAd.findFirst({ where: { id, agencyId }, select: { id: true, startDate: true, endDate: true } });
  if (!existing) throw new SiteAdError(404, "Ad not found.");

  const data: Prisma.SiteAdUpdateInput = {};
  if (body.title !== undefined) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) throw new SiteAdError(400, "Title cannot be empty.");
    if (t.length > 120) throw new SiteAdError(400, "Ad title is too long (max 120 characters).");
    data.title = t;
  }
  if (body.image !== undefined) {
    data.imageUrl = httpUrl(body.image, "Ad image");
  }
  if (body.linkUrl !== undefined) data.linkUrl = body.linkUrl ? httpUrl(body.linkUrl, "Link") : null;
  if (body.position !== undefined) {
    data.position = validPosition(body.position);
  }
  if (body.status !== undefined) data.status = dbStatus(body.status);
  const sd = toDate(body.startDate);
  if (sd !== undefined) data.startDate = sd;
  const ed = toDate(body.endDate);
  if (ed !== undefined) data.endDate = ed;
  checkRange(sd === undefined ? existing.startDate : sd, ed === undefined ? existing.endDate : ed);
  if (body.order !== undefined) data.order = validOrder(body.order);

  const row = await db.siteAd.update({ where: { id }, data, select: SELECT });
  return toApi(row);
}

export async function deleteSiteAd(agencyId: string, id: string) {
  const existing = await db.siteAd.findFirst({ where: { id, agencyId }, select: { id: true } });
  if (!existing) throw new SiteAdError(404, "Ad not found.");
  await db.siteAd.delete({ where: { id } });
}
