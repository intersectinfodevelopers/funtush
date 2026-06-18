import { upload } from "@funtush/storage";
import { Router } from "express";
import { createReview } from "src/controllers/review.controller";

const router = Router();

router.route('/reviews')
    .post(upload.array("photos",10),createReview);


export default router;