import { Router } from "express";
import { upload } from "@funtush/storage";
import { requireAuth } from "@funtush/auth";
import { uploadSingle, uploadMultiple, deleteUpload } from "../controllers/upload.controller.js";

const router = Router();

/**
 * @openapi
 * /upload:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload a single file (multipart, field name "file")
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Uploaded — returns the file URL }, 400: { description: No file provided } }
 *   delete:
 *     tags: [Uploads]
 *     summary: Delete an uploaded file by URL
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Deleted }, 400: { description: url required } }
 * /upload/multiple:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload up to 5 files (multipart, field name "files")
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Uploaded — returns the file URLs }, 400: { description: No files provided } }
 */
router.post("/upload", requireAuth, upload.single("file"), uploadSingle);
router.post("/upload/multiple", requireAuth, upload.array("files", 5), uploadMultiple);
router.delete("/upload", requireAuth, deleteUpload);

export default router;
