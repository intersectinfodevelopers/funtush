import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "@funtush/auth";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware.js";
import { getPlatformSettings, updatePlatformSettings } from "../../services/platformSettings.service.js";
import { writeAuditLog } from "../../services/auditLog.service.js";
import { prisma } from "@funtush/database";

const router = Router();

/** `updatedBy` is stored as a raw User.id — resolve it to an email for display, same as the audit log does. */
async function withUpdatedByEmail<T extends { updatedBy: string | null }>(settings: T): Promise<T & { updatedByEmail: string | null }> {
  if (!settings.updatedBy) return { ...settings, updatedByEmail: null };
  const user = await prisma.user.findUnique({ where: { id: settings.updatedBy }, select: { email: true } });
  return { ...settings, updatedByEmail: user?.email ?? null };
}

function clientIp(req: Request): string {
  return (
    req.ip ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function adminId(req: Request): string {
  return req.user?.userId ?? "unknown-admin";
}

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     tags: [Admin]
 *     summary: Read platform-wide runtime settings (e.g. whether agency registration requires phone OTP)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Settings } }
 *   patch:
 *     tags: [Admin]
 *     summary: Update platform-wide runtime settings — requires a super-admin session
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content: { application/json: { schema: { type: object, properties: { agencyPhoneOtpRequired: { type: boolean } } } } }
 *     responses: { 200: { description: Updated }, 403: { description: Requires platform admin privileges } }
 */
router.get("/", requireAuth, requirePlatformPermission("settings"), async (_req: Request, res: Response) => {
  try {
    const settings = await getPlatformSettings();
    res.json({ success: true, data: await withUpdatedByEmail(settings) });
  } catch (err) {
    console.error("[GET /admin/settings]", err);
    res.status(500).json({ error: "Failed to load platform settings" });
  }
});

router.patch("/", requireAuth, requirePlatformPermission("settings"), async (req: Request, res: Response) => {
  try {
    const { agencyPhoneOtpRequired } = req.body as { agencyPhoneOtpRequired?: unknown };
    if (agencyPhoneOtpRequired !== undefined && typeof agencyPhoneOtpRequired !== "boolean") {
      res.status(400).json({ error: "agencyPhoneOtpRequired must be a boolean" });
      return;
    }

    const updated = await updatePlatformSettings({ agencyPhoneOtpRequired }, adminId(req));

    await writeAuditLog({
      action: "PLATFORM_SETTINGS_CHANGED", actor_id: adminId(req), actor_ip: clientIp(req),
      target_type: "platform", target_id: "singleton",
      metadata: { agencyPhoneOtpRequired: updated.agencyPhoneOtpRequired },
    });

    res.json({ success: true, data: await withUpdatedByEmail(updated) });
  } catch (err) {
    console.error("[PATCH /admin/settings]", err);
    res.status(500).json({ error: "Failed to update platform settings" });
  }
});

export default router;
