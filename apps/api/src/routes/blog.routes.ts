import { upload } from "@funtush/storage";
import { Router } from "express";
import { createBlog, createcategory, getAgencyBlogs, getAgencycategories, updateBlog, updatecategory } from "src/controllers/blog.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

/**
 * @openapi
 * /agencies/me/categories:
 *   get: { tags: [Blog], summary: List the agency's blog categories, security: [{ refreshToken: [] }], responses: { 200: { description: Categories } } }
 *   post: { tags: [Blog], summary: Create a blog category, security: [{ refreshToken: [] }], responses: { 201: { description: Created } } }
 * /agencies/me/categories/{id}:
 *   patch: { tags: [Blog], summary: Update a blog category, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 * /agencies/me/blogs:
 *   get: { tags: [Blog], summary: List the agency's blog posts, security: [{ refreshToken: [] }], responses: { 200: { description: Posts } } }
 *   post: { tags: [Blog], summary: Create a blog post (multipart, up to 10 photos), security: [{ refreshToken: [] }], responses: { 201: { description: Created } } }
 * /agencies/me/blogs/{id}:
 *   patch: { tags: [Blog], summary: Update a blog post (multipart, up to 10 photos), security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 */
router.route('/agencies/me/categories')
    .get(authenticateWithRefreshToken, getAgencycategories)
    .post(authenticateWithRefreshToken, createcategory);

router.route('/agencies/me/categories/:id')
    .patch(authenticateWithRefreshToken, updatecategory)

router.route('/agencies/me/blogs')
    .get(authenticateWithRefreshToken, getAgencyBlogs)
    .post(authenticateWithRefreshToken, upload.array("photos", 10), createBlog);
    

router.route('/agencies/me/blogs/:id')
    .patch(authenticateWithRefreshToken, upload.array("photos", 10), updateBlog)

export default router;
