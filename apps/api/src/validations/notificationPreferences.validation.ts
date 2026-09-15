/**
 * ── Request validation for the notification-preferences endpoint ─────────────
 * (backend catch-up pass)
 *
 * Same split every module in this pass uses: this file answers "is this
 * request well-formed"; `notificationPreferences.service.ts` answers "does
 * the merged result make sense" (the welcome-back-popup coherence rule) and
 * "what does the platform force regardless of what was sent" (SOS email).
 *
 * `preferences` is an explicit object with the eight known event keys, not a
 * `z.record(...)` keyed by arbitrary strings — matching this codebase's
 * general preference for whitelisting a fixed, known set over accepting
 * anything shaped roughly right.
 */

import { z } from "zod";
import { MAX_WELCOME_BACK_MESSAGE_LENGTH } from "../data/notifications";

const channelPatch = z
  .object({
    email: z.boolean().optional(),
    inApp: z.boolean().optional(),
  })
  .strict();

export const notificationPreferencesUpdateSchema = z
  .object({
    preferences: z
      .object({
        newInquiry: channelPatch.optional(),
        paymentReceived: channelPatch.optional(),
        bookingCancelled: channelPatch.optional(),
        newReview: channelPatch.optional(),
        sosTriggered: channelPatch.optional(),
        lowSlots: channelPatch.optional(),
        subscription: channelPatch.optional(),
        weeklyDigest: channelPatch.optional(),
      })
      .strict()
      .optional(),

    welcomeBackPopupEnabled: z.boolean().optional(),

    /**
     * `.nullable()`, the usual meaning throughout this pass: `null` clears the
     * override back to the platform's own line, an absent key leaves it
     * alone. `<`/`>` rejected — this text is rendered into a card in the
     * trekker's app, same defence-in-depth reasoning as every other
     * rendered-text field in this pass.
     */
    welcomeBackPopupMessage: z
      .string()
      .trim()
      .max(
        MAX_WELCOME_BACK_MESSAGE_LENGTH,
        `Popup message must be at most ${MAX_WELCOME_BACK_MESSAGE_LENGTH} characters`,
      )
      .refine((value) => !/[<>]/.test(value), {
        message: "Popup message must not contain < or >",
      })
      .nullable()
      .optional(),
  })
  /** Reject unknown keys rather than silently dropping them — every module's rule. */
  .strict();

export type NotificationPreferencesUpdateInput = z.infer<typeof notificationPreferencesUpdateSchema>;
