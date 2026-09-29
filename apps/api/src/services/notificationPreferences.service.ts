/**
 * ── Notification-preferences service (backend catch-up pass) ─────────────────
 *
 * Owns `PATCH /agencies/me/notification-preferences`. Unlike every other
 * module added in this pass, there is no public read here at all — see
 * `data/notifications.ts` for why this isn't part of the public site — so
 * this file is entirely dashboard-facing and never calls `queueRegeneration`.
 *
 * Shape of the API: sixteen flat boolean columns in Postgres, but the
 * dashboard (and the frontend this mirrors) thinks in terms of "eight events,
 * each with an email and an in-app toggle" — so this file's first job is
 * translating between the two, in one place, so the read and write paths
 * cannot drift into disagreeing about which column is which event's.
 */

import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_WELCOME_BACK_POPUP,
  NOTIFICATION_EVENT_IDS,
  isEmailLocked,
  type NotificationChannel,
  type NotificationEventId,
} from "../data/notifications";
import type { NotificationPreferencesUpdateInput } from "../validations/notificationPreferences.validation";
import { getAgencyBrandContext } from "./branding.service";

/* ── Types ───────────────────────────────────────────────────────────────── */

/** The subset of an `agency_notification_preferences` row this module reads. */
export interface NotificationPreferenceRow {
  newInquiryEmail: boolean;
  newInquiryInApp: boolean;
  paymentReceivedEmail: boolean;
  paymentReceivedInApp: boolean;
  bookingCancelledEmail: boolean;
  bookingCancelledInApp: boolean;
  newReviewEmail: boolean;
  newReviewInApp: boolean;
  sosTriggeredEmail: boolean;
  sosTriggeredInApp: boolean;
  lowSlotsEmail: boolean;
  lowSlotsInApp: boolean;
  subscriptionEmail: boolean;
  subscriptionInApp: boolean;
  weeklyDigestEmail: boolean;
  weeklyDigestInApp: boolean;
  welcomeBackPopupEnabled: boolean;
  welcomeBackPopupMessage: string | null;
  updatedAt: Date;
}

/** The boolean-valued columns of the row — excludes `welcomeBackPopupMessage`
 * (a string) and `updatedAt` (a Date), so indexing `row[cols.email]` below is
 * known to be a `boolean`, not the union of every column's type. */
type BooleanColumn = {
  [K in keyof NotificationPreferenceRow]: NotificationPreferenceRow[K] extends boolean ? K : never;
}[keyof NotificationPreferenceRow];

/** One flat column pair per event — the single place that mapping is written down. */
const EVENT_COLUMNS: Record<NotificationEventId, { email: BooleanColumn; inApp: BooleanColumn }> = {
  newInquiry: { email: "newInquiryEmail", inApp: "newInquiryInApp" },
  paymentReceived: { email: "paymentReceivedEmail", inApp: "paymentReceivedInApp" },
  bookingCancelled: { email: "bookingCancelledEmail", inApp: "bookingCancelledInApp" },
  newReview: { email: "newReviewEmail", inApp: "newReviewInApp" },
  sosTriggered: { email: "sosTriggeredEmail", inApp: "sosTriggeredInApp" },
  lowSlots: { email: "lowSlotsEmail", inApp: "lowSlotsInApp" },
  subscription: { email: "subscriptionEmail", inApp: "subscriptionInApp" },
  weeklyDigest: { email: "weeklyDigestEmail", inApp: "weeklyDigestInApp" },
};

export interface WelcomeBackPopup {
  enabled: boolean;
  message: string;
}

export interface MergedNotificationPreferences {
  preferences: Record<NotificationEventId, NotificationChannel>;
  welcomeBackPopup: WelcomeBackPopup;
}

export interface EditableNotificationPreferences extends MergedNotificationPreferences {
  updatedAt: Date | null;
}

/* ── 1. Row ⇄ nested shape ───────────────────────────────────────────────── */

/** The stored row with all defaults applied — the state before a patch. */
export function withDefaults(row: NotificationPreferenceRow | null): MergedNotificationPreferences {
  const preferences = {} as Record<NotificationEventId, NotificationChannel>;

  for (const eventId of NOTIFICATION_EVENT_IDS) {
    const cols = EVENT_COLUMNS[eventId];
    const fallback = DEFAULT_NOTIFICATION_PREFERENCES[eventId];
    preferences[eventId] = {
      email: row ? row[cols.email] : fallback.email,
      inApp: row ? row[cols.inApp] : fallback.inApp,
    };
  }

  // Forced, not merely defaulted — a stale row saved before this rule existed
  // must not be able to leave SOS email off. Same shape as `resolveFuntushBadge`.
  preferences.sosTriggered.email = true;

  return {
    preferences,
    welcomeBackPopup: {
      enabled: row?.welcomeBackPopupEnabled ?? DEFAULT_WELCOME_BACK_POPUP.enabled,
      message: row?.welcomeBackPopupMessage ?? DEFAULT_WELCOME_BACK_POPUP.message,
    },
  };
}

/**
 * Apply a patch and return what the preferences *would* be if it saved —
 * checked for coherence before anything is written, same shape as every
 * other module's `mergePatch`.
 */
export function mergePatch(
  row: NotificationPreferenceRow | null,
  input: NotificationPreferencesUpdateInput,
): MergedNotificationPreferences {
  const merged = withDefaults(row);

  if (input.preferences) {
    for (const eventId of NOTIFICATION_EVENT_IDS) {
      const patch = input.preferences[eventId];
      if (!patch) continue;
      if (patch.email !== undefined) merged.preferences[eventId].email = patch.email;
      if (patch.inApp !== undefined) merged.preferences[eventId].inApp = patch.inApp;
    }
    merged.preferences.sosTriggered.email = true;
  }

  if (input.welcomeBackPopupEnabled !== undefined) {
    merged.welcomeBackPopup.enabled = input.welcomeBackPopupEnabled;
  }
  if (input.welcomeBackPopupMessage !== undefined) {
    merged.welcomeBackPopup.message = input.welcomeBackPopupMessage ?? DEFAULT_WELCOME_BACK_POPUP.message;
  }

  return merged;
}

/**
 * Reject a configuration that would render as an empty popup card — the same
 * rule `siteConfig.service.ts` applies to its own popup, for the same reason:
 * a switched-on popup with nothing in it looks broken, not off.
 */
export function assertCoherent(merged: MergedNotificationPreferences): void {
  if (merged.welcomeBackPopup.enabled && !merged.welcomeBackPopup.message.trim()) {
    throw httpError(400, "Add a popup message before turning the welcome-back popup on.");
  }
}

/* ── 2. Reads ────────────────────────────────────────────────────────────── */

export async function getNotificationPreferences(agencyId: string): Promise<EditableNotificationPreferences> {
  const row = (await db.agencyNotificationPreference.findUnique({
    where: { agencyId },
  })) as NotificationPreferenceRow | null;

  return { ...withDefaults(row), updatedAt: row?.updatedAt ?? null };
}

/** The event catalog + defaults the settings screen draws its list from. */
export async function getNotificationPreferenceOptions(agencyId: string) {
  // Confirms the agency exists (404s otherwise) even though nothing here is
  // tier-specific — matches every sibling `get*Options` in this pass.
  await getAgencyBrandContext(agencyId);

  return {
    events: NOTIFICATION_EVENT_IDS.map((id) => ({
      ...DEFAULT_NOTIFICATION_PREFERENCES[id],
      id,
      emailLocked: isEmailLocked(id),
    })),
  };
}

/* ── 3. The write ────────────────────────────────────────────────────────── */

/**
 * Apply a notification-preferences PATCH.
 *
 * No tier rule (nothing here is a paid feature) and no regeneration (nothing
 * here is public site content) — see the file header. What survives from
 * every sibling module: merge-then-check-coherence against the *merged*
 * state, one `upsert`, and a column patch built key by key so an omitted
 * field truly does nothing.
 */
export async function updateNotificationPreferences(
  agencyId: string,
  input: NotificationPreferencesUpdateInput,
): Promise<EditableNotificationPreferences> {
  // Confirms the agency exists — the 404 every sibling module gets from
  // `getAgencyBrandContext`, even though this module needs none of its tier
  // information.
  await getAgencyBrandContext(agencyId);

  const existing = (await db.agencyNotificationPreference.findUnique({
    where: { agencyId },
  })) as NotificationPreferenceRow | null;

  if (Object.keys(input).length === 0) {
    throw httpError(400, "No notification preference fields provided to update");
  }

  const merged = mergePatch(existing, input);
  assertCoherent(merged);

  const data: Record<string, unknown> = {};

  if (input.preferences) {
    for (const eventId of NOTIFICATION_EVENT_IDS) {
      const patch = input.preferences[eventId];
      if (!patch) continue;
      const cols = EVENT_COLUMNS[eventId];

      if (patch.email !== undefined) {
        // Silently kept true rather than rejecting the whole save — see
        // `isEmailLocked`'s doc comment for why this is an override, not an error.
        data[cols.email] = isEmailLocked(eventId) ? true : patch.email;
      }
      if (patch.inApp !== undefined) data[cols.inApp] = patch.inApp;
    }
  }

  if (input.welcomeBackPopupEnabled !== undefined) {
    data.welcomeBackPopupEnabled = input.welcomeBackPopupEnabled;
  }
  if (input.welcomeBackPopupMessage !== undefined) {
    data.welcomeBackPopupMessage = input.welcomeBackPopupMessage;
  }

  await db.agencyNotificationPreference.upsert({
    where: { agencyId },
    update: data,
    create: { agencyId, ...data },
  });

  // Re-read through `getNotificationPreferences` so the response comes from
  // the same code path as a plain GET.
  return getNotificationPreferences(agencyId);
}
