import { Router } from "express";
import { GalleryController, VideosController } from "../controllers/media.controller.js";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";

const router = Router();

router.use(["/agencies/me/gallery", "/agencies/me/videos"], authenticateWithRefreshToken);

/**
 * @openapi
 * /agencies/me/gallery:
 *   get:
 *     tags: [Media]
 *     summary: List gallery posts
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: status, in: query, schema: { type: string, enum: [all, published, draft] } }
 *       - { name: search, in: query, schema: { type: string } }
 *     responses: { 200: { description: Gallery posts }, 401: { description: Unauthorized } }
 *   post:
 *     tags: [Media]
 *     summary: Create a gallery post (1-5 images)
 *     security: [{ refreshToken: [] }]
 *     responses: { 201: { description: Created }, 400: { description: Validation failed } }
 * /agencies/me/gallery/{id}:
 *   get: { tags: [Media], summary: Get a gallery post, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: OK }, 404: { description: Not found } } }
 *   patch: { tags: [Media], summary: Update a gallery post, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 404: { description: Not found } } }
 *   delete: { tags: [Media], summary: Delete a gallery post, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 404: { description: Not found } } }
 */
router.route("/agencies/me/gallery").get(GalleryController.list).post(GalleryController.create);
router
  .route("/agencies/me/gallery/:id")
  .get(GalleryController.get)
  .patch(GalleryController.update)
  .delete(GalleryController.remove);

/**
 * @openapi
 * /agencies/me/videos:
 *   get:
 *     tags: [Media]
 *     summary: List videos
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: status, in: query, schema: { type: string, enum: [all, active, inactive] } }
 *       - { name: search, in: query, schema: { type: string } }
 *     responses: { 200: { description: Videos }, 401: { description: Unauthorized } }
 *   post:
 *     tags: [Media]
 *     summary: Add a video (YouTube URL)
 *     security: [{ refreshToken: [] }]
 *     responses: { 201: { description: Created }, 400: { description: Validation failed } }
 * /agencies/me/videos/{id}:
 *   get: { tags: [Media], summary: Get a video, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: OK }, 404: { description: Not found } } }
 *   patch: { tags: [Media], summary: Update a video, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Updated }, 404: { description: Not found } } }
 *   delete: { tags: [Media], summary: Delete a video, security: [{ refreshToken: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 204: { description: Deleted }, 404: { description: Not found } } }
 */
router.route("/agencies/me/videos").get(VideosController.list).post(VideosController.create);
router
  .route("/agencies/me/videos/:id")
  .get(VideosController.get)
  .patch(VideosController.update)
  .delete(VideosController.remove);

export default router;
