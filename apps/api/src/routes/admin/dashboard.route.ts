import { Router } from "express";
import { requireAuth } from "@funtush/auth";
import { requireSuperAdminRole } from "../../middleware/requireSuperAdminRole.middleware.js";
import { getDashboardStats } from "../../services/admin.service.js";

const router = Router();

// Was gated only by the IP allow-list (`requireAdmin` on the parent router) —
// require a real platform-admin session too, matching every other admin route.
router.use(requireAuth, requireSuperAdminRole);


router.get("/", async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (err) {
    console.error("[GET /admin/dashboard]", err);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

export default router;
