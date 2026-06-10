import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.middleware";
import dashboardRouter from "./dashboard.route";
import agenciesRouter  from "./agencies.route";

const router = Router();


router.use(requireAdmin);

router.use("/dashboard", dashboardRouter);
router.use("/agencies",  agenciesRouter);

export default router;
