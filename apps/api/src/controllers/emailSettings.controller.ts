/**
 * ── Email-settings controllers (backend catch-up pass) ────────────────────────
 *
 * Thin, like every sibling in this pass. Dashboard-only, always
 * `private, no-store` — no public read for this module (see
 * `data/emailSettings.ts`).
 */

import type { Request, Response } from "express";
import { getEmailSettings, updateEmailSettings } from "../services/emailSettings.service";
import type { EmailSettingsUpdateInput } from "../validations/emailSettings.validation";

const PRIVATE_NO_STORE = "private, no-store";

function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

/** `GET /agencies/me/email-settings` — the settings screen's current values. */
export async function getMyEmailSettings(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const settings = await getEmailSettings(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: settings });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/email-settings");
  }
}

/** `PATCH /agencies/me/email-settings`. JSON only, no multer. */
export async function patchMyEmailSettings(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = req.agencyId as string;
    if (!agencyId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const input = req.body as EmailSettingsUpdateInput;
    const settings = await updateEmailSettings(agencyId, input);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      message: "Email settings updated",
      data: settings,
    });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/email-settings");
  }
}
