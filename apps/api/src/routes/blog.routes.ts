import { upload } from "@funtush/storage";
import { Router } from "express";
import { createBlog, deleteBlog, getAgencyBlogs, getBlogPhotoLibrary, updateBlog } from "src/controllers/blog.controller";
import * as cat from "../services/blogCategory.service";
import type { Request, Response } from "express";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

/**
 * @openapi
 * /agencies/me/categories:
 *   get: { tags: [Blog], summary: List the agency's blog categories, security: [{ refreshToken: [] }], responses: { 200: { description: Categories } } }
 *   post: { tags: [Blog], summary: Create a blog category, security: [{ refreshToken: [] }], responses: { 201: { description: Created } } }
 * /agencies/me/categories/{id}:
 *   get: { tags: [Blog], summary: Get a blog category with its posts, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Category }, 404: { description: Not found } } }
 *   delete: { tags: [Blog], summary: Delete a blog category (refused while posts use it), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 409: { description: In use } } }
 *   patch: { tags: [Blog], summary: Update a blog category, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 * /agencies/me/blogs:
 *   get: { tags: [Blog], summary: "List the agency's blog posts (paginated)", security: [{ refreshToken: [] }], parameters: [{ name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }, { name: limit, in: query, description: "Clamped to 1-100", schema: { type: integer, minimum: 1, maximum: 100, default: 50 } }], responses: { 200: { description: "{ success, count, data: Post[], meta: { total, page, limit, pages } }" } } }
 *   post: { tags: [Blog], summary: Create a blog post (multipart, one photo), security: [{ refreshToken: [] }], responses: { 201: { description: Created } } }
 * /agencies/me/blogs/{id}:
 *   patch: { tags: [Blog], summary: Update a blog post (multipart, one photo), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 *   delete: { tags: [Blog], summary: Delete a blog post, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 404: { description: Not found } } }
 * /agencies/me/blogs/photo-library:
 *   get: { tags: [Blog], summary: "Photos the agency has previously uploaded for a blog post, for the \"Add from Gallery\" picker", security: [{ refreshToken: [] }], parameters: [{ name: search, in: query, schema: { type: string } }, { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }, { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 48, default: 12 } }], responses: { 200: { description: "{ success, items, total, page, limit }" } } }
 */
const fail = (res: Response, err: unknown) => {
    const e = err as { status?: number; field?: string; message?: string };
    const status = e.status ?? 500;
    if (status >= 500) { console.error("[categories]", err); return res.status(500).json({ success: false, message: "Something went wrong" }); }
    return res.status(status).json({ success: false, message: e.message, ...(e.field ? { errors: { [e.field]: e.message } } : {}) });
};
const agencyOf = (req: Request) => req.agencyId as string;
const idOf = (req: Request) => String(req.params.id);

router.route('/agencies/me/categories')
    .get(authenticateWithRefreshToken, async (req, res) => {
        try { const r = await cat.listCategories(agencyOf(req)); res.json({ success: true, count: r.data.length, ...r }); } catch (e) { fail(res, e); }
    })
    .post(authenticateWithRefreshToken, async (req, res) => {
        try { res.status(201).json({ success: true, data: await cat.createCategory(agencyOf(req), req.body ?? {}) }); } catch (e) { fail(res, e); }
    });

router.route('/agencies/me/categories/:id')
    .get(authenticateWithRefreshToken, async (req, res) => {
        try { res.json({ success: true, data: await cat.getCategory(agencyOf(req), idOf(req)) }); } catch (e) { fail(res, e); }
    })
    .patch(authenticateWithRefreshToken, async (req, res) => {
        try { res.json({ success: true, data: await cat.updateCategory(agencyOf(req), idOf(req), req.body ?? {}) }); } catch (e) { fail(res, e); }
    })
    .delete(authenticateWithRefreshToken, async (req, res) => {
        try { await cat.deleteCategory(agencyOf(req), idOf(req)); res.status(204).send(); } catch (e) { fail(res, e); }
    });

router.route('/agencies/me/blogs')
    .get(authenticateWithRefreshToken, getAgencyBlogs)
    .post(authenticateWithRefreshToken, upload.array("photos", 1), createBlog);

// Must be registered before the generic /agencies/me/blogs/:id route so "photo-library" isn't read as an id.
router.get('/agencies/me/blogs/photo-library', authenticateWithRefreshToken, getBlogPhotoLibrary);

router.route('/agencies/me/blogs/:id')
    .patch(authenticateWithRefreshToken, upload.array("photos", 1), updateBlog)
    .delete(authenticateWithRefreshToken, deleteBlog)

export default router;
