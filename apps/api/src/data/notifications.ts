/**
 * ── The notification-preferences option table (backend catch-up pass) ────────
 *
 * Same idea as `siteConfig.ts`: the pure, database-free facts a preferences
 * save depends on. Unlike every other module in this pass, this one is **not**
 * part of the public white-label site at all — it's the agency's own alert
 * routing (which events reach it by email vs. in-app) plus a popup shown
 * inside the *trekker's* app to a returning customer, based on their booking
 * history. Neither of those is content a site visitor's browser ever fetches,
 * which is why this module (unlike Branding/SiteConfig/Navigation/Social/SEO)
 * has no public `/site/:slug/...` read and never queues a regeneration.
 *
 * ⚠️ This file must not import from `@funtush/database`.
 */

export type NotificationEventId =
  | "newInquiry"
  | "paymentReceived"
  | "bookingCancelled"
  | "newReview"
  | "sosTriggered"
  | "lowSlots"
  | "subscription"
  | "weeklyDigest";

export interface NotificationEvent {
  id: NotificationEventId;
  label: string;
  description: string;
}

export const NOTIFICATION_EVENTS: Record<NotificationEventId, NotificationEvent> = {
  newInquiry: {
    id: "newInquiry",
    label: "New booking inquiry",
    description: "A trekker submits an inquiry for one of your packages.",
  },
  paymentReceived: {
    id: "paymentReceived",
    label: "Payment received",
    description: "A trekker completes payment on an accepted booking.",
  },
  bookingCancelled: {
    id: "bookingCancelled",
    label: "Booking cancelled or expired",
    description: "A booking is cancelled, rejected, or its payment window expires.",
  },
  newReview: {
    id: "newReview",
    label: "New review",
    description: "A customer leaves a review for a completed trek.",
  },
  sosTriggered: {
    id: "sosTriggered",
    label: "SOS / safety incident",
    description: "A guide or trekker triggers an SOS. Always on for email.",
  },
  lowSlots: {
    id: "lowSlots",
    label: "Departure almost full",
    description: "A departure date drops below 3 remaining seats.",
  },
  subscription: {
    id: "subscription",
    label: "Subscription & billing",
    description: "Renewals, failed payments and plan changes.",
  },
  weeklyDigest: {
    id: "weeklyDigest",
    label: "Weekly summary",
    description: "A Monday digest of bookings, revenue and reviews.",
  },
};

export const NOTIFICATION_EVENT_IDS = Object.keys(NOTIFICATION_EVENTS) as NotificationEventId[];

/**
 * SOS is a life-safety channel (Backend Guide §0.1's "never gated" category,
 * same spirit applied to routing rather than tier access): the one event an
 * agency may never silence over email, no matter what it PATCHes. Enforced in
 * the service by overwriting the merged value, not by rejecting the request —
 * an agency sending `{sosTriggered: {email: false}}` alongside nine other
 * legitimate changes should not have the whole save bounce for one field the
 * platform is going to override anyway.
 */
export function isEmailLocked(eventId: NotificationEventId): boolean {
  return eventId === "sosTriggered";
}

export interface NotificationChannel {
  email: boolean;
  inApp: boolean;
}

/**
 * In-app is the default everywhere — it costs nothing to show and an agency
 * sees it the moment it opens the dashboard. Email defaults to off except for
 * SOS, so a new agency's inbox does not fill up with routine activity before
 * it has decided what it actually wants to hear about away from its desk.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Record<NotificationEventId, NotificationChannel> = {
  newInquiry: { email: false, inApp: true },
  paymentReceived: { email: false, inApp: true },
  bookingCancelled: { email: false, inApp: true },
  newReview: { email: false, inApp: true },
  sosTriggered: { email: true, inApp: true },
  lowSlots: { email: false, inApp: true },
  subscription: { email: false, inApp: true },
  weeklyDigest: { email: false, inApp: true },
};

/**
 * Shown as a small card, not a full page — 140 characters (one SMS-length
 * message, the same borrow `siteConfig.ts`'s top-bar limit makes) is enough
 * for a friendly line without inviting a paragraph.
 */
export const MAX_WELCOME_BACK_MESSAGE_LENGTH = 140;

export const DEFAULT_WELCOME_BACK_POPUP = {
  enabled: true,
  message: "Welcome back! Ready to plan your next trek with us?",
} as const;
