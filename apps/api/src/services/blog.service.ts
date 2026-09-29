import { db } from "@funtush/database";
import { sanitizeRichText, stripHtml } from "../lib/sanitizeHtml";

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

/** Cleans a raw tags array: strips HTML, drops blanks/overlong entries, dedupes case-insensitively, caps at MAX_TAGS. */
function sanitizeTags(raw: unknown): string[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error("tags must be a list of strings");
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        const clean = stripHtml(String(item ?? "")).trim();
        if (!clean) continue;
        if (clean.length > MAX_TAG_LENGTH) throw new Error(`Each tag can be at most ${MAX_TAG_LENGTH} characters.`);
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
    }
    if (out.length > MAX_TAGS) throw new Error(`A post can have at most ${MAX_TAGS} tags.`);
    return out;
}

interface CreateBlogPayload {
    title: string;
    subtitle?: string;
    content: string;
    categoryId: string;
    status: string;
    tags?: unknown;
    photos?: string[];
    publishAt?: unknown;
    authorName?: string | null;
    /** Photos uploaded as part of THIS request — recorded into the agency's reusable photo library. */
    newUploads?: Array<{ url: string; title: string }>;
}

interface UpdateBlogPayload {
    title?: string;
    subtitle?: string;
    content?: string;
    categoryId?: string;
    status?: string;
    tags?: unknown;
    photos?: string[];
    publishAt?: unknown;
    newUploads?: Array<{ url: string; title: string }>;
}

export const createBlogService = async (
    agencyUserId: string,
    data: CreateBlogPayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }


    if (!data.title || !data.content || !data.categoryId) {
        throw new Error("Please fill out the required fields.");
    }

    // The category must belong to THIS agency. Without the check an agency could
    // file a blog under a competitor's category by id, polluting it — and the
    // response echoed the category's name back (a cross-tenant read).
    const ownCategory = await db.category.findFirst({
        where: { id: data.categoryId, agencyId: agencyUser.agencyId },
        select: { id: true, isActive: true },
    });
    if (!ownCategory) {
        throw new Error("Category not found");
    }
    if (!ownCategory.isActive) {
        throw new Error("This category is inactive. Choose an active category.");
    }

    const status = normalizeBlogStatus(data.status);
    const publishAt = status === "SCHEDULED" ? parseFuturePublishAt(data.publishAt) : null;

    const blog = await db.blog.create({
        data: {
            agencyId: agencyUser.agencyId,
            title: stripHtml(data.title),
            subtitle: stripHtml(data.subtitle ?? ""),
            // Stored HTML is rendered on public sites — never trust it (see lib/sanitizeHtml).
            content: sanitizeRichText(data.content),
            categoryId: data.categoryId,
            status,
            tags: sanitizeTags(data.tags),
            photos: data?.photos,
            publishAt,
            authorName: data.authorName ? stripHtml(data.authorName).slice(0, 120) : null,
        },
        include: {
            category: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });
    await recordBlogPhotos(agencyUser.agencyId, data.newUploads);
    return blog;
}

/** Blog.status is a free-text column and the public site keys off "PUBLISHED" — accept only the two real values. */
const normalizeBlogStatus = (status: unknown): string | undefined => {
    if (status === undefined || status === null || status === "") return undefined;
    const v = String(status).toUpperCase();
    if (v !== "DRAFT" && v !== "PUBLISHED" && v !== "SCHEDULED") throw new Error("status must be DRAFT, PUBLISHED or SCHEDULED");
    return v;
};

/** A future Date for a SCHEDULED post, or throws with a message the form can show under Publish Date. */
function parseFuturePublishAt(raw: unknown): Date {
    const d = new Date(String(raw ?? ""));
    if (Number.isNaN(d.getTime())) throw new Error("Choose a valid publish date and time.");
    if (d.getTime() <= Date.now()) throw new Error("Publish date must be in the future.");
    return d;
}

const MAX_LIBRARY_TITLE = 120;

/** Records newly-uploaded blog photos into the agency's reusable library (dedup by URL). Never
 * called for a photo reused from the library itself or kept from the post's existing photos. */
async function recordBlogPhotos(agencyId: string, uploads?: Array<{ url: string; title: string }>) {
    if (!uploads || uploads.length === 0) return;
    await db.blogPhoto.createMany({
        data: uploads.map((u) => ({ agencyId, url: u.url, title: stripHtml(u.title).slice(0, MAX_LIBRARY_TITLE) || "photo" })),
        skipDuplicates: true,
    });
}

export async function listBlogPhotoLibrary(agencyUserId: string, q: { search?: unknown; page?: unknown; limit?: unknown }) {
    const agencyUser = await db.agencyUser.findUnique({ where: { id: agencyUserId }, select: { agencyId: true } });
    if (!agencyUser) throw new Error("Agency user not found");

    const limit = Math.min(Math.max(parseInt(String(q.limit ?? "12"), 10) || 12, 1), 48);
    const page = Math.max(parseInt(String(q.page ?? "1"), 10) || 1, 1);
    const search = String(q.search ?? "").trim();

    const where = { agencyId: agencyUser.agencyId, ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}) };
    const [items, total] = await Promise.all([
        db.blogPhoto.findMany({ where, select: { id: true, url: true, title: true, createdAt: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
        db.blogPhoto.count({ where }),
    ]);
    return { items, total, page, limit };
}

export const updateBlogService = async (
    agencyUserId: string,
    blogId: string,
    data: UpdateBlogPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const blog = await db.blog.findFirst({
        where: {
            id: blogId,
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            status: true,
            publishAt: true,
        }
    });

    if (!blog)
        throw new Error("Blog not found");

    // publishAt is touched only when status or publishAt is actually part of this edit — a text-only
    // edit (e.g. just the title) must not disturb an existing schedule.
    let publishAt: Date | null | undefined;
    if (data.status !== undefined || data.publishAt !== undefined) {
        const nextStatus = normalizeBlogStatus(data.status) ?? blog.status ?? "DRAFT";
        if (nextStatus === "SCHEDULED") {
            publishAt = data.publishAt !== undefined
                ? parseFuturePublishAt(data.publishAt)
                : blog.publishAt && blog.publishAt.getTime() > Date.now() ? blog.publishAt : (() => { throw new Error("Choose a publish date in the future."); })();
        } else {
            publishAt = null;
        }
    }

    if (data.categoryId) {
        const category = await db.category.findFirst({
            where: {
                id: data.categoryId,
                agencyId: agencyUser.agencyId,
            },
            select: {
                id: true,
                isActive: true,
            },
        });

        if (!category) {
            throw new Error("Category not found");
        }
        if (!category.isActive) {
            throw new Error("This category is inactive. Choose an active category.");
        }
    }

    const updated = await db.blog.update({
        where: {
            id: blogId
        },
        data: {
            title: data?.title === undefined ? undefined : stripHtml(data.title),
            subtitle: data?.subtitle === undefined ? undefined : stripHtml(data.subtitle),
            content: data?.content === undefined ? undefined : sanitizeRichText(data.content),
            categoryId: data?.categoryId,
            status: normalizeBlogStatus(data?.status),
            tags: data?.tags === undefined ? undefined : sanitizeTags(data.tags),
            photos: data?.photos,
            publishAt,
        },
        include: {
            category: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });
    await recordBlogPhotos(agencyUser.agencyId, data.newUploads);
    return updated;
}

export async function deleteBlogService(agencyUserId: string, blogId: string) {
    const agencyUser = await db.agencyUser.findUnique({ where: { id: agencyUserId }, select: { agencyId: true } });
    if (!agencyUser) throw new Error("Agency user not found");

    const blog = await db.blog.findFirst({ where: { id: blogId, agencyId: agencyUser.agencyId }, select: { id: true, title: true } });
    if (!blog) throw new Error("Blog not found");

    await db.blog.delete({ where: { id: blogId } });
    return { title: blog.title };
}

export const getBlogsService = async (
    agencyUserId: string,
    page: { skip: number; take: number },
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const where = { agencyId: agencyUser.agencyId };

    const [data, total] = await Promise.all([
        db.blog.findMany({
            where,
            select: {
                // id was missing, so a client couldn't tell which blog to update
                id: true,
                title: true,
                subtitle: true,
                content: true,
                status: true,
                tags: true,
                photos: true,
                publishAt: true,
                authorName: true,
                views: true,
                createdAt: true,
                category: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            skip: page.skip,
            take: page.take,
        }),
        db.blog.count({ where }),
    ]);

    return { data, total };
}