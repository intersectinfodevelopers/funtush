import { db, Prisma } from "@funtush/database";

/**
 * Media — agency content: gallery posts + videos.
 * API shape follows funtush-frontend/data/{gallery,videos}.json (status lowercased).
 */

export class MediaServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function lower(s: string): string {
  return s.toLowerCase();
}

// ═══ Gallery ════════════════════════════════════════════════════════════════

const GALLERY_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  images: true,
  featuredImage: true,
  status: true,
  order: true,
  likes: true,
  views: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GalleryPostSelect;

type GalleryRow = Prisma.GalleryPostGetPayload<{ select: typeof GALLERY_SELECT }>;

function toApiGallery(r: GalleryRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    images: r.images,
    featuredImage: r.featuredImage,
    status: lower(r.status),
    order: r.order,
    likes: r.likes,
    views: r.views,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export interface GalleryInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  images?: string[];
  featuredImage?: string | null;
  status?: string;
  order?: number;
}

function galleryStatus(s: string | undefined): "PUBLISHED" | "DRAFT" | undefined {
  if (s === undefined) return undefined;
  return s.toLowerCase() === "draft" ? "DRAFT" : "PUBLISHED";
}

/** featuredImage must be one of images; default to the first. */
function pickFeatured(images: string[], wanted?: string | null): string | null {
  if (wanted && images.includes(wanted)) return wanted;
  return images[0] ?? null;
}

export async function listGallery(
  agencyId: string,
  q: { status?: string; search?: string; page?: number; limit?: number } = {},
) {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const where: Prisma.GalleryPostWhereInput = { agencyId };
  if (q.status && q.status.toLowerCase() !== "all") where.status = galleryStatus(q.status);
  if (q.search?.trim()) {
    where.OR = [
      { title: { contains: q.search.trim(), mode: "insensitive" } },
      { description: { contains: q.search.trim(), mode: "insensitive" } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.galleryPost.findMany({
      where,
      select: GALLERY_SELECT,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.galleryPost.count({ where }),
  ]);
  return { items: rows.map(toApiGallery), total, page, limit };
}

export async function createGallery(agencyId: string, body: GalleryInput) {
  const title = (body.title ?? "").trim();
  if (!title) throw new MediaServiceError(400, "Gallery post title is required.");
  const images = (body.images ?? []).filter((s) => typeof s === "string" && s.trim() !== "").slice(0, 5);
  if (images.length === 0) throw new MediaServiceError(400, "At least one image is required.");

  const row = await db.galleryPost.create({
    data: {
      agencyId,
      title,
      description: body.description?.trim() || null,
      category: body.category?.trim() || null,
      images,
      featuredImage: pickFeatured(images, body.featuredImage),
      status: galleryStatus(body.status) ?? "PUBLISHED",
      order: body.order ?? 0,
    },
    select: GALLERY_SELECT,
  });
  return toApiGallery(row);
}

export async function getGallery(agencyId: string, id: string) {
  const row = await db.galleryPost.findFirst({ where: { id, agencyId }, select: GALLERY_SELECT });
  if (!row) throw new MediaServiceError(404, "Gallery post not found.");
  return toApiGallery(row);
}

export async function updateGallery(agencyId: string, id: string, body: GalleryInput) {
  const existing = await db.galleryPost.findFirst({
    where: { id, agencyId },
    select: { images: true, featuredImage: true },
  });
  if (!existing) throw new MediaServiceError(404, "Gallery post not found.");

  const data: Prisma.GalleryPostUpdateInput = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) throw new MediaServiceError(400, "Title cannot be empty.");
    data.title = t;
  }
  if (body.description !== undefined) data.description = body.description?.trim() || null;
  if (body.category !== undefined) data.category = body.category?.trim() || null;
  if (body.order !== undefined) data.order = body.order;
  if (body.status !== undefined) data.status = galleryStatus(body.status);

  const nextImages =
    body.images !== undefined
      ? body.images.filter((s) => typeof s === "string" && s.trim() !== "").slice(0, 5)
      : existing.images;
  if (body.images !== undefined) {
    if (nextImages.length === 0) throw new MediaServiceError(400, "At least one image is required.");
    data.images = nextImages;
  }
  if (body.images !== undefined || body.featuredImage !== undefined) {
    data.featuredImage = pickFeatured(nextImages, body.featuredImage ?? existing.featuredImage);
  }

  const row = await db.galleryPost.update({ where: { id }, data, select: GALLERY_SELECT });
  return toApiGallery(row);
}

export async function deleteGallery(agencyId: string, id: string) {
  const existing = await db.galleryPost.findFirst({ where: { id, agencyId }, select: { id: true } });
  if (!existing) throw new MediaServiceError(404, "Gallery post not found.");
  await db.galleryPost.delete({ where: { id } });
}

// ═══ Videos ═════════════════════════════════════════════════════════════════

const VIDEO_SELECT = {
  id: true,
  title: true,
  description: true,
  youtubeUrl: true,
  thumbnailUrl: true,
  status: true,
  order: true,
  likes: true,
  views: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VideoSelect;

type VideoRow = Prisma.VideoGetPayload<{ select: typeof VIDEO_SELECT }>;

function toApiVideo(r: VideoRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    youtubeUrl: r.youtubeUrl,
    thumbnail: r.thumbnailUrl,
    status: lower(r.status),
    order: r.order,
    likes: r.likes,
    views: r.views,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export interface VideoInput {
  title?: string;
  description?: string | null;
  youtubeUrl?: string;
  thumbnail?: string | null;
  status?: string;
  order?: number;
}

function videoStatus(s: string | undefined): "ACTIVE" | "INACTIVE" | undefined {
  if (s === undefined) return undefined;
  return s.toLowerCase() === "inactive" ? "INACTIVE" : "ACTIVE";
}

const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]{6,}/i;

export async function listVideos(
  agencyId: string,
  q: { status?: string; search?: string; page?: number; limit?: number } = {},
) {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const where: Prisma.VideoWhereInput = { agencyId };
  if (q.status && q.status.toLowerCase() !== "all") where.status = videoStatus(q.status);
  if (q.search?.trim()) {
    where.OR = [
      { title: { contains: q.search.trim(), mode: "insensitive" } },
      { description: { contains: q.search.trim(), mode: "insensitive" } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.video.findMany({
      where,
      select: VIDEO_SELECT,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.video.count({ where }),
  ]);
  return { items: rows.map(toApiVideo), total, page, limit };
}

export async function createVideo(agencyId: string, body: VideoInput) {
  const title = (body.title ?? "").trim();
  const url = (body.youtubeUrl ?? "").trim();
  if (!title) throw new MediaServiceError(400, "Video title is required.");
  if (!url) throw new MediaServiceError(400, "A YouTube URL is required.");
  if (!YT_RE.test(url)) throw new MediaServiceError(400, "That doesn't look like a YouTube URL.");

  const row = await db.video.create({
    data: {
      agencyId,
      title,
      description: body.description?.trim() || null,
      youtubeUrl: url,
      thumbnailUrl: body.thumbnail?.trim() || null,
      status: videoStatus(body.status) ?? "ACTIVE",
      order: body.order ?? 0,
    },
    select: VIDEO_SELECT,
  });
  return toApiVideo(row);
}

export async function getVideo(agencyId: string, id: string) {
  const row = await db.video.findFirst({ where: { id, agencyId }, select: VIDEO_SELECT });
  if (!row) throw new MediaServiceError(404, "Video not found.");
  return toApiVideo(row);
}

export async function updateVideo(agencyId: string, id: string, body: VideoInput) {
  const existing = await db.video.findFirst({ where: { id, agencyId }, select: { id: true } });
  if (!existing) throw new MediaServiceError(404, "Video not found.");

  const data: Prisma.VideoUpdateInput = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) throw new MediaServiceError(400, "Title cannot be empty.");
    data.title = t;
  }
  if (body.description !== undefined) data.description = body.description?.trim() || null;
  if (body.youtubeUrl !== undefined) {
    const u = body.youtubeUrl.trim();
    if (!u || !YT_RE.test(u)) throw new MediaServiceError(400, "That doesn't look like a YouTube URL.");
    data.youtubeUrl = u;
  }
  if (body.thumbnail !== undefined) data.thumbnailUrl = body.thumbnail?.trim() || null;
  if (body.order !== undefined) data.order = body.order;
  if (body.status !== undefined) data.status = videoStatus(body.status);

  const row = await db.video.update({ where: { id }, data, select: VIDEO_SELECT });
  return toApiVideo(row);
}

export async function deleteVideo(agencyId: string, id: string) {
  const existing = await db.video.findFirst({ where: { id, agencyId }, select: { id: true } });
  if (!existing) throw new MediaServiceError(404, "Video not found.");
  await db.video.delete({ where: { id } });
}
