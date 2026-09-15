/**
 * ── The social-links option table (backend catch-up pass) ────────────────────
 *
 * Same idea as `brandTheme.ts` (Day 1) and `siteConfig.ts` (Day 2): the pure,
 * database-free facts a social-links save depends on, so the validation
 * schema and the service read one definition each instead of two that can
 * drift apart.
 *
 * Unlike Day 1/2, nothing here is tier-gated. Every agency — trial included —
 * gets to say who it is on social media, same reasoning as branding: a set of
 * social links is not a paid feature, it's part of having a site at all.
 *
 * ⚠️ Like its siblings, this file must not import from `@funtush/database`.
 */

/** The five profile fields this module stores. */
export type SocialLinksField = "facebookUrl" | "instagramUrl" | "tiktokUrl" | "whatsappNumber" | "youtubeUrl";

/**
 * Length ceiling for every field. One number, not per-field, because none of
 * these is prose with a "recommended" length the way SEO copy is — they're a
 * URL or a phone number, and 2048 is the same URL-safety ceiling
 * `siteConfig.ts`'s `SITE_TEXT_LIMITS.url` uses, reused rather than
 * reinvented.
 */
export const MAX_SOCIAL_FIELD_LENGTH = 2048;

/** What an agency that has never opened this screen has saved. All unset. */
export const DEFAULT_SOCIAL_LINKS: Record<SocialLinksField, null> = {
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
  whatsappNumber: null,
  youtubeUrl: null,
};

/**
 * `true` when `value` looks like a phone number a `wa.me/` link can be built
 * from: digits only, 7–15 of them (the range E.164 allows), optionally
 * preceded by `+`.
 *
 * Deliberately not the strict E.164 regex some libraries use — an agency
 * pastes numbers in every local format ("+977 98XXXXXXXX", "9841234567"),
 * and this module's job is to store enough to build a working link, not to
 * be a phone-number validator. The renderer strips non-digits before
 * building the `wa.me/` URL either way (mirrors the frontend's own
 * `replace(/[^0-9]/g, "")`).
 */
export function isPlausibleWhatsAppNumber(value: string): boolean {
  return /^\+?\d{7,15}$/.test(value.replace(/[\s-]/g, ""));
}
