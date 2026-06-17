import { Router } from "express";
import { registerTrekker, trekkerPreference } from "src/controllers/Trekkers/trekker.controller";

const router = Router();

router.route('/create/trekker')
    .post(registerTrekker);

router.route('/trekker-preferences')
    .patch(trekkerPreference);

export default router;