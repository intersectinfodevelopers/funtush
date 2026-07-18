import type {
  NotificationChannel,
  NotificationEventType,
  NotificationPriority,
} from "../types/notification.types";

export interface MatrixEntry {
  priority: NotificationPriority;
  channels: NotificationChannel[];
}

/**
 * Channel priority matrix — single source of truth for how each event
 * type is delivered.
 *
 * Rules enforced by notification.service.ts:
 *   - CRITICAL  → bypasses Do Not Disturb, all listed channels fire.
 *   - HIGH      → respects DND for push, but email + in_app still deliver.
 *   - MEDIUM    → respects DND entirely (skipped channels are recorded).
 *   - LOW       → in_app only by convention; silently dropped under DND.
 *
 * Add new event types here — notifyUser refuses unknown event types
 * so nothing gets sent with an unintended priority.
 */
export const NOTIFICATION_MATRIX: Record<NotificationEventType, MatrixEntry> = {
  // ---- CRITICAL: safety & money — always delivered, DND ignored ----
  SOS_ALERT:        { priority: "CRITICAL", channels: ["push", "sms", "email", "in_app"] },
  PAYMENT_FAILED:   { priority: "CRITICAL", channels: ["push", "email", "in_app"] },

  // ---- HIGH: booking lifecycle ----
  BOOKING_CONFIRMED: { priority: "HIGH", channels: ["push", "email", "in_app"] },
  BOOKING_CANCELLED: { priority: "HIGH", channels: ["push", "email", "in_app"] },
  KYC_REJECTED:      { priority: "HIGH", channels: ["push", "email", "in_app"] },

  // ---- MEDIUM: useful but deferrable ----
  KYC_APPROVED:  { priority: "MEDIUM", channels: ["push", "email", "in_app"] },
  TRIP_REMINDER: { priority: "MEDIUM", channels: ["push", "in_app"] },
  NEW_MESSAGE:   { priority: "MEDIUM", channels: ["push", "in_app"] },

  // ---- LOW: marketing / nice-to-have ----
  PROMO: { priority: "LOW", channels: ["in_app"] },
};

/** Channels that DND can suppress. in_app is never suppressed (it's passive). */
export const DND_SUPPRESSIBLE: NotificationChannel[] = ["push", "sms"];