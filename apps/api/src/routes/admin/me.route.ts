import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "@funtush/auth";
import { prisma } from "@funtush/database";

const router = Router();

/**
 * @openapi
 * /admin/me:
 *   get:
 *     tags: [Admin]
 *     summary: The signed-in platform user's own role and permissions — used by the admin frontend to decide what to show in navigation, not to grant access (every route still checks for itself).
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Profile }, 403: { description: Not a platform user } }
 */
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const user = req.user;
  if (!user || user.roleType !== "PLATFORM") {
    res.status(403).json({ error: "Requires platform admin privileges" });
    return;
  }
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { id: true, email: true, role: true, isActive: true, permissions: true },
  });
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ success: true, data: row });
});

export default router;
