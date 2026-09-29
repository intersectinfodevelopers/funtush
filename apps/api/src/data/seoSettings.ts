/**
 * ── The SEO-settings option table (backend catch-up pass) ────────────────────
 *
 * Same idea as `siteConfig.ts` (Day 2): the pure, database-free facts an
 * SEO-settings save depends on. Not tier-gated — every agency's site needs a
 * title and description, same reasoning `socialLinks.ts` gives.
 *
 * ⚠️ Like its siblings, this file must not import from `@funtush/database`.
 */

/**
 * One table so the validation schema, the error messages and the settings
 * UI's character counters all read the same numbers — see `siteConfig.ts`'s
 * `SITE_TEXT_LIMITS` for why a limit in two places is a limit that
 * disagrees with itself.
 *
 * The numbers themselves are the real limits search engines actually
 * truncate at (~60 chars for a title, ~160 for a description in Google's
 * results), not arbitrary column widths.
 */
export const SEO_TEXT_LIMITS = {
  metaTitle: { max: 60 },
  metaDescription: { max: 160 },
} as const;

/** What an agency that has never opened this screen has saved. All unset. */
export const DEFAULT_SEO_SETTINGS = {
  metaTitle: null,
  metaDescription: null,
  ogImageUrl: null,
} as const;
