import { Router } from "express";
import { upload } from "@funtush/storage";
import { requireAuth } from "@funtush/auth";
import { uploadSingle, uploadMultiple, deleteUpload } from "../controllers/upload.controller";

const router = Router();

router.post("/upload", requireAuth, upload.single("file"), uploadSingle);
router.post("/upload/multiple", requireAuth, upload.array("files", 5), uploadMultiple);
router.delete("/upload", requireAuth, deleteUpload);

export default router;
