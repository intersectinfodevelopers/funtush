/**
 * ── Notification-preferences controllers (backend catch-up pass) ─────────────
 *
 * Thin, like every sibling in this pass. Both reads are dashboard-only and
 * always `private, no-store` — there is no public read for this module (see
 * `data/notifications.ts`), so there's no caching complexity to speak of.
 */

import type { Request, Response } from "express";
import {
  getNotificationPreferenceOptions,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../services/notificationPreferences.service";
import type { NotificationPreferencesUpdateInput } from "../validations/notificationPreferences.validation";

const PRIVATE_NO_STORE = "private, no-store";

function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

/** `GET /agencies/me/notification-preferences` — the settings screen's current values. */
export async function getMyNotificationPreferences(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const preferences = await getNotificationPreferences(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: preferences });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/notification-preferences");
  }
}

/** `GET /agencies/me/notification-preferences/options` — the event catalog. */
export async function getMyNotificationPreferenceOptions(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const options = await getNotificationPreferenceOptions(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: options });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/notification-preferences/options");
  }
}

/** `PATCH /agencies/me/notification-preferences`. JSON only, no multer. */
export async function patchMyNotificationPreferences(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const input = req.body as NotificationPreferencesUpdateInput;
    const preferences = await updateNotificationPreferences(agencyId, input);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      message: "Notification preferences updated",
      data: preferences,
    });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/notification-preferences");
  }
}
