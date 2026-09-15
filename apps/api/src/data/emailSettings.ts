/**
 * ── The email-settings option table (backend catch-up pass) ──────────────────
 *
 * Same idea as `notifications.ts`: the pure, database-free facts an
 * email-settings save depends on. Like notifications, this is **not** part of
 * the public white-label site — it's how the agency's own outgoing emails
 * (booking confirmations, payment links, trek reminders, review invites)
 * identify themselves — so there is no public `/site/:slug/...` read and no
 * regeneration is queued on save.
 *
 * ⚠️ This file must not import from `@funtush/database`.
 */

export const MAX_SENDER_NAME_LENGTH = 80;
export const MAX_FOOTER_TEXT_LENGTH = 300;

export const DEFAULT_EMAIL_SETTINGS = {
  senderName: null,
  fromAddress: null,
  replyTo: null,
  footerText: "Sent by your trekking agency via Funtush.",
  includeUnsubscribe: true,
  bccBookingsTo: null,
} as const;

/**
 * A plain, single-address email shape check — good enough to catch a typo
 * before it reaches a send, not a full RFC 5322 validator. Matches the
 * frontend's own `emailOk` check exactly, so a value either side accepts is
 * accepted on both.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
