import { Router } from "express";
import type { Request, Response } from "express";
import { authenticateWithRefreshToken } from "../middleware/refreshTokenAuthentication.js";
import { getAgencyBreakGlassHistory } from "../services/breakGlass.service.js";

const router = Router();

/**
 * @openapi
 * /agencies/me/break-glass:
 *   get:
 *     tags: [Agency]
 *     summary: When platform admins were granted emergency access to this agency
 *     description: Transparency view — timestamps, reason and status only (no token, no admin IP).
 *     security: [{ refreshToken: [] }]
 *     responses:
 *       200: { description: "History: [{ id, reason, issuedAt, expiresAt, usedAt, revokedAt, status }]" }
 *       401: { description: Unauthorized }
 */
router.get("/agencies/me/break-glass", authenticateWithRefreshToken, async (req: Request, res: Response) => {
  const agencyId = req.agencyId;
  if (!agencyId) return res.status(401).json({ success: false, message: "Unauthorized" });
  res.json({ success: true, data: await getAgencyBreakGlassHistory(agencyId) });
});

export default router;
