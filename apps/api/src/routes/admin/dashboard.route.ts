import { Router } from "express";
import { getDashboardStats } from "../../services/admin.service";

const router = Router();


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
