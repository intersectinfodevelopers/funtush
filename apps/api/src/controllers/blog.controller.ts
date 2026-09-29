import { uploadFile } from "@funtush/storage";
import type { Request, Response } from "express";
import { parsePagination, buildMeta } from "../utils/pagination";
import { createBlogService, deleteBlogService, getBlogsService, listBlogPhotoLibrary, updateBlogService } from "src/services/blog.service";
import { resolveActor } from "src/services/packageActivity.service";

const MAX_PHOTOS = 1;
const cdnPrefix = () => (process.env.CDN_BASE_URL ? `${process.env.CDN_BASE_URL}/` : null);

/** Parses a JSON array of our own CDN URLs (used for `keepPhotos` — existing photos to retain on
 * edit — and `photoUrls` — photos picked from the agency's Gallery instead of newly uploaded). */
function parseCdnUrlArray(raw: unknown, field: string): string[] {
    if (raw === undefined) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(raw));
    } catch {
        throw new Error(`${field} must be a JSON array of URLs`);
    }
    const cdn = cdnPrefix();
    if (!Array.isArray(parsed)) throw new Error(`${field} must be a JSON array of URLs`);
    return parsed.filter((u): u is string => typeof u === "string" && cdn !== null && u.startsWith(cdn));
}

/** `tags` arrives as a JSON-stringified array over multipart form data. */
function parseTags(raw: unknown): unknown {
    if (raw === undefined || Array.isArray(raw)) return raw;
    try {
        return JSON.parse(String(raw));
    } catch {
        throw new Error("tags must be a JSON array of strings");
    }
}

export const createBlog = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const files = (req.files as Express.Multer.File[]) || [];
        const uploaded = await Promise.all(files.map((photo) => uploadFile(photo)));
        const newUploads = files.map((f, i) => ({ url: uploaded[i], title: f.originalname }));
        const photoUrls = parseCdnUrlArray(req.body?.photoUrls, "photoUrls");
        const photos = [...uploaded, ...photoUrls];
        if (photos.length > MAX_PHOTOS) {
            return res.status(400).json({ success: false, message: "A post can have only one photo." });
        }

        const actor = await resolveActor(req);

        const blog = await createBlogService(
            agencyUserId,
            {
                ...req.body,
                tags: parseTags(req.body?.tags),
                photos,
                newUploads,
                authorName: actor?.name ?? null,
            }
        );

        return res.status(201).json({
            success: true,
            data: blog,
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const updateBlog = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const blogId = req.params.id as string;

        const files = (req.files as Express.Multer.File[]) || [];
        const uploaded = await Promise.all(files.map((photo) => uploadFile(photo)));
        const newUploads = files.map((f, i) => ({ url: uploaded[i], title: f.originalname }));

        // Photos change ONLY when the caller says so: new uploaded files, an explicit `keepPhotos`
        // (JSON array of existing URLs to retain), and/or `photoUrls` (photos picked from the agency's
        // Gallery). This used to always send `photos: urls`, so a text-only edit set photos to [] and
        // deleted the post's images.
        const keepGiven = req.body?.keepPhotos !== undefined;
        const keep = keepGiven ? parseCdnUrlArray(req.body.keepPhotos, "keepPhotos") : undefined;
        const photoUrls = parseCdnUrlArray(req.body?.photoUrls, "photoUrls");
        const nextPhotos = keepGiven || uploaded.length > 0 || photoUrls.length > 0
            ? [...(keep ?? []), ...uploaded, ...photoUrls]
            : undefined;
        if (nextPhotos && nextPhotos.length > MAX_PHOTOS) {
            return res.status(400).json({ success: false, message: "A post can have only one photo." });
        }

        const blog = await updateBlogService(
            agencyUserId,
            blogId,
            {
                ...req.body,
                tags: parseTags(req.body?.tags),
                photos: nextPhotos,
                newUploads,
            });

        return res.status(200).json({
            success: true,
            data: blog,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const deleteBlog = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        await deleteBlogService(agencyUserId, String(req.params.id));
        return res.status(204).send();
    } catch (err) {
        const status = err instanceof Error && err.message === "Blog not found" ? 404 : 400;
        return res.status(status).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const getBlogPhotoLibrary = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;
        const data = await listBlogPhotoLibrary(agencyUserId, req.query as Record<string, unknown>);
        return res.status(200).json({ success: true, ...data });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

export const getAgencyBlogs = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const pageReq = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
        const { data, total } = await getBlogsService(agencyUserId, pageReq);

        return res.status(200).json({
            success: true,
            count: data.length,
            data,
            meta: buildMeta(total, pageReq.page, pageReq.limit),
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};
