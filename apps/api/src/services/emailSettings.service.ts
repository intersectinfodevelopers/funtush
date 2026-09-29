/**
 * ── Email-settings service (backend catch-up pass) ────────────────────────────
 *
 * Owns `PATCH /agencies/me/email-settings`. Like
 * `notificationPreferences.service.ts`, there is no public read and no
 * `queueRegeneration` call — see `data/emailSettings.ts` for why.
 *
 * No tier rule, no coherence rule between fields — every field here is
 * independent, so this is the simplest module in the pass: `withDefaults`,
 * one `upsert`, re-read through the same getter a plain GET uses.
 *
 * **What this does not do yet, on purpose:** `emailService.ts` (the platform's
 * actual send pipeline) does not read this table — every outgoing email still
 * uses the platform's own hardcoded sender identity. Wiring these settings
 * into real sends touches many call sites across booking/review/KYC flows and
 * is a materially bigger, separate piece of work, the same way the
 * page-builder was flagged as its own future phase rather than folded into
 * this pass.
 */

import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";
import { DEFAULT_EMAIL_SETTINGS } from "../data/emailSettings";
import type { EmailSettingsUpdateInput } from "../validations/emailSettings.validation";
import { getAgencyBrandContext } from "./branding.service";

/** The subset of an `agency_email_settings` row this module reads. */
export interface EmailSettingsRow {
  senderName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  footerText: string | null;
  includeUnsubscribe: boolean;
  bccBookingsTo: string | null;
  updatedAt: Date;
}

export interface EmailSettingsValues {
  senderName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  footerText: string | null;
  includeUnsubscribe: boolean;
  bccBookingsTo: string | null;
}

export interface EditableEmailSettings {
  values: EmailSettingsValues;
  updatedAt: Date | null;
}

/** The stored row with all defaults applied — the state before a patch. */
export function withDefaults(row: EmailSettingsRow | null): EmailSettingsValues {
  return {
    senderName: row?.senderName ?? DEFAULT_EMAIL_SETTINGS.senderName,
    fromAddress: row?.fromAddress ?? DEFAULT_EMAIL_SETTINGS.fromAddress,
    replyTo: row?.replyTo ?? DEFAULT_EMAIL_SETTINGS.replyTo,
    footerText: row?.footerText ?? DEFAULT_EMAIL_SETTINGS.footerText,
    includeUnsubscribe: row?.includeUnsubscribe ?? DEFAULT_EMAIL_SETTINGS.includeUnsubscribe,
    bccBookingsTo: row?.bccBookingsTo ?? DEFAULT_EMAIL_SETTINGS.bccBookingsTo,
  };
}

/** The dashboard read. */
export async function getEmailSettings(agencyId: string): Promise<EditableEmailSettings> {
  const row = (await db.agencyEmailSettings.findUnique({ where: { agencyId } })) as EmailSettingsRow | null;

  return { values: withDefaults(row), updatedAt: row?.updatedAt ?? null };
}

/** Apply an email-settings PATCH. */
export async function updateEmailSettings(
  agencyId: string,
  input: EmailSettingsUpdateInput,
): Promise<EditableEmailSettings> {
  // Confirms the agency exists — the 404 every module in this pass gets from
  // `getAgencyBrandContext`, even though this module needs none of its tier
  // information.
  await getAgencyBrandContext(agencyId);

  if (Object.keys(input).length === 0) {
    throw httpError(400, "No email setting fields provided to update");
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) data[key] = value;
  }

  await db.agencyEmailSettings.upsert({
    where: { agencyId },
    update: data,
    create: { agencyId, ...data },
  });

  // Re-read through `getEmailSettings` so the response comes from the same
  // code path as a plain GET.
  return getEmailSettings(agencyId);
}
