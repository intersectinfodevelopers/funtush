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
  { id: "homepage-top", label: "Homepage Top" },
  { id: "sidebar-1", label: "Sidebar Slot 1" },
  { id: "footer-1", label: "Footer Slot 1" },
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
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
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
  q: { status?: string; position?: string; page?: number; limit?: number } = {},
) {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const where: Prisma.SiteAdWhereInput = { agencyId };
  if (q.status && q.status.toLowerCase() !== "all") where.status = dbStatus(q.status);
  if (q.position && q.position.toLowerCase() !== "all") where.position = q.position;

  const [rows, total] = await Promise.all([
    db.siteAd.findMany({
      where,
      select: SELECT,
      orderBy: [{ position: "asc" }, { order: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.siteAd.count({ where }),
  ]);
  return { ads: rows.map(toApi), total, page, limit };
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
  const title = (body.title ?? "").trim();
  const image = (body.image ?? "").trim();
  const position = (body.position ?? "").trim();
  if (!title) throw new SiteAdError(400, "Ad title is required.");
  if (!image) throw new SiteAdError(400, "An ad image is required.");
  if (!position) throw new SiteAdError(400, "A placement position is required.");

  const row = await db.siteAd.create({
    data: {
      agencyId,
      title,
      imageUrl: image,
      linkUrl: body.linkUrl?.trim() || null,
      position,
      status: dbStatus(body.status) ?? "ACTIVE",
      startDate: toDate(body.startDate) ?? null,
      endDate: toDate(body.endDate) ?? null,
      order: body.order ?? 0,
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
  const existing = await db.siteAd.findFirst({ where: { id, agencyId }, select: { id: true } });
  if (!existing) throw new SiteAdError(404, "Ad not found.");

  const data: Prisma.SiteAdUpdateInput = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) throw new SiteAdError(400, "Title cannot be empty.");
    data.title = t;
  }
  if (body.image !== undefined) {
    const i = body.image.trim();
    if (!i) throw new SiteAdError(400, "Image cannot be empty.");
    data.imageUrl = i;
  }
  if (body.linkUrl !== undefined) data.linkUrl = body.linkUrl?.trim() || null;
  if (body.position !== undefined) {
    const p = body.position.trim();
    if (!p) throw new SiteAdError(400, "Position cannot be empty.");
    data.position = p;
  }
  if (body.status !== undefined) data.status = dbStatus(body.status);
  const sd = toDate(body.startDate);
  if (sd !== undefined) data.startDate = sd;
  const ed = toDate(body.endDate);
  if (ed !== undefined) data.endDate = ed;
  if (body.order !== undefined) data.order = body.order;

  const row = await db.siteAd.update({ where: { id }, data, select: SELECT });
  return toApi(row);
}

export async function deleteSiteAd(agencyId: string, id: string) {
  const existing = await db.siteAd.findFirst({ where: { id, agencyId }, select: { id: true } });
  if (!existing) throw new SiteAdError(404, "Ad not found.");
  await db.siteAd.delete({ where: { id } });
}
