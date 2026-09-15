/**
 * ── Request validation for the email-settings endpoint (backend catch-up pass)
 *
 * Same split every module in this pass uses: this file answers "is this
 * request well-formed"; `emailSettings.service.ts` has no coherence rules of
 * its own to add — every field here is independent, same as
 * `socialLinks.validation.ts`.
 */

import { z } from "zod";
import { MAX_FOOTER_TEXT_LENGTH, MAX_SENDER_NAME_LENGTH, isPlausibleEmail } from "../data/emailSettings";

/**
 * A single email address. `.nullable()`, the usual meaning throughout this
 * pass: `null` clears the override, an absent key leaves it alone.
 */
const emailField = z
  .string()
  .trim()
  .refine(isPlausibleEmail, { message: "Enter a valid email address" })
  .nullable()
  .optional();

/** Text rendered into an email footer — `<`/`>` rejected, same defence-in-depth
 * reasoning as every other rendered-text field in this pass. */
function safeText(field: string, max: number) {
  return z
    .string()
    .trim()
    .max(max, `${field} must be at most ${max} characters`)
    .refine((value) => !/[<>]/.test(value), {
      message: `${field} must not contain < or >`,
    });
}

export const emailSettingsUpdateSchema = z
  .object({
    senderName: safeText("Sender name", MAX_SENDER_NAME_LENGTH).nullable().optional(),
    fromAddress: emailField,
    replyTo: emailField,
    footerText: safeText("Footer text", MAX_FOOTER_TEXT_LENGTH).nullable().optional(),
    includeUnsubscribe: z.boolean().optional(),
    bccBookingsTo: emailField,
  })
  /** Reject unknown keys rather than silently dropping them — every module's rule. */
  .strict();

export type EmailSettingsUpdateInput = z.infer<typeof emailSettingsUpdateSchema>;
