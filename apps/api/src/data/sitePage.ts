/**
 * ── The page-builder option tables (backend catch-up pass, Phase 8) ──────────
 *
 * Everything that is *policy* rather than *one agency's data* for the
 * page-builder — starter templates, the section-type catalog, shape limits,
 * per-section-type defaults — lives here, the same convention as
 * `brandTheme.ts` (Day 1), `siteConfig.ts` (Day 2) and `navigation.ts` (Day 3).
 *
 * This module is the backend counterpart of the frontend prototype's
 * `src/lib/mock/site-pages.ts`: the same 6 templates, the same 11 section
 * types, and the same flat per-section field set, expressed as a typed
 * whitelist instead of hardcoded React state.
 *
 * Every enum-shaped id here is **UPPERCASE**, matching the Prisma enum values
 * (`SitePageSectionType`, `SitePageVariant`, ...) exactly, the same
 * convention Day 2's `TopBarBehaviorId` ("STATIC" | "SCROLLING") and Day 3's
 * `NavigationLinkTypeId` ("INTERNAL" | "EXTERNAL") use — one casing for a
 * value as it travels from the wire, through zod, into a Prisma write, and
 * back out again, with no translation layer to keep in sync.
 *
 * ⚠️ Like its siblings, this file must not import `@funtush/database`. It is
 * read by the validation layer before any database call, and by tests that
 * run with no database at all.
 */

import type { TierName } from "./brandTheme";
import { SITE_TEXT_LIMITS, isSafeLinkUrl } from "./siteConfig";
import { isSafeInternalPath } from "./navigation";

/* ── 1. Section types ────────────────────────────────────────────────────── */

export type SitePageSectionTypeId =
  | "TOPBAR"
  | "HERO"
  | "CATEGORIES"
  | "TEXTBLOCK"
  | "BLOGS"
  | "PACKAGES"
  | "DESTINATIONS"
  | "VIDEOS"
  | "GALLERY"
  | "REVIEWS"
  | "ADS";

export interface SectionTypeDefinition {
  value: SitePageSectionTypeId;
  label: string;
  description: string;
  group: "Layout" | "Content";
}

export const SECTION_TYPES: readonly SectionTypeDefinition[] = [
  { value: "TOPBAR", label: "Scrolling Banner", description: "A marquee-style promo strip.", group: "Layout" },
  { value: "HERO", label: "Hero Banner", description: "A large image with a title and subtitle.", group: "Layout" },
  { value: "CATEGORIES", label: "Popular Categories", description: "A row of highlight cards.", group: "Layout" },
  { value: "TEXTBLOCK", label: "Text Block", description: "A heading plus a paragraph.", group: "Layout" },
  { value: "PACKAGES", label: "Packages", description: "Bookable treks, live from Packages.", group: "Content" },
  { value: "DESTINATIONS", label: "Destinations", description: "Regions, live from Destinations.", group: "Content" },
  { value: "BLOGS", label: "Blog Posts", description: "Latest published posts.", group: "Content" },
  { value: "GALLERY", label: "Photo Gallery", description: "Published photos.", group: "Content" },
  { value: "VIDEOS", label: "Videos", description: "Published trek videos.", group: "Content" },
  { value: "REVIEWS", label: "Reviews", description: "Trekker reviews.", group: "Content" },
  { value: "ADS", label: "Ad Placement", description: "A promo banner from Advertisements.", group: "Content" },
] as const;

export const SECTION_TYPE_IDS = SECTION_TYPES.map((s) => s.value) as SitePageSectionTypeId[];

/**
 * The section types backed by a real curated list (packages, destinations,
 * etc.) rather than free-text layout — the ones `itemCount`/`selectedIds`
 * apply to. `ADS` is deliberately excluded: it has its own single
 * `adPosition` slot instead of a curated list.
 */
export const DATA_SECTION_TYPES: readonly SitePageSectionTypeId[] = [
  "BLOGS",
  "PACKAGES",
  "DESTINATIONS",
  "VIDEOS",
  "GALLERY",
  "REVIEWS",
];

export function isDataSectionType(type: string): boolean {
  return (DATA_SECTION_TYPES as readonly string[]).includes(type);
}

/* ── 2. Templates ────────────────────────────────────────────────────────── */

export type SitePageVariantId = "CLASSIC" | "MINIMAL" | "EDITORIAL" | "BOLD" | "ELEGANT" | "PLAYFUL";

export const SITE_VARIANTS: readonly SitePageVariantId[] = [
  "CLASSIC",
  "MINIMAL",
  "EDITORIAL",
  "BOLD",
  "ELEGANT",
  "PLAYFUL",
];

export type SiteTemplateTierId = "FREE" | "PAID";

export interface SiteTemplateDefinition {
  id: string;
  name: string;
  description: string;
  variant: SitePageVariantId;
  tier: SiteTemplateTierId;
  /** The starter section list a fresh site gets when this template is applied. */
  sections: readonly SitePageSectionTypeId[];
}

/**
 * The platform's 6 starter templates, matching the frontend prototype's
 * `TEMPLATES` exactly (`site-pages.ts:130-185`). `SITE_TEMPLATES[0]` is the
 * platform default — the same free classic template
 * `readOrCreateSite()`/`siteFromTemplate()` seeds a never-configured agency
 * with.
 */
export const SITE_TEMPLATES: readonly SiteTemplateDefinition[] = [
  {
    id: "classic-trek-operator",
    name: "Classic Trek Operator",
    description: "A dependable, no-surprises layout for an established agency.",
    variant: "CLASSIC",
    tier: "FREE",
    sections: ["TOPBAR", "HERO", "PACKAGES", "DESTINATIONS", "REVIEWS", "TEXTBLOCK", "ADS"],
  },
  {
    id: "adventure-landing",
    name: "Adventure Landing",
    description: "A lean, single-purpose landing page built to convert.",
    variant: "MINIMAL",
    tier: "PAID",
    sections: ["HERO", "CATEGORIES", "TEXTBLOCK", "REVIEWS"],
  },
  {
    id: "himalayan-story",
    name: "Himalayan Story",
    description: "Editorial and photo-led, for an agency that publishes.",
    variant: "EDITORIAL",
    tier: "PAID",
    sections: ["TOPBAR", "HERO", "BLOGS", "GALLERY", "VIDEOS", "TEXTBLOCK", "REVIEWS", "DESTINATIONS"],
  },
  {
    id: "expedition-pro",
    name: "Expedition Pro",
    description: "A bold, media-heavy layout for technical expeditions.",
    variant: "BOLD",
    tier: "PAID",
    sections: ["TOPBAR", "HERO", "GALLERY", "VIDEOS", "PACKAGES", "DESTINATIONS", "REVIEWS", "TEXTBLOCK", "ADS"],
  },
  {
    id: "boutique-trekking",
    name: "Boutique Trekking",
    description: "An understated, elegant layout for a small curated catalogue.",
    variant: "ELEGANT",
    tier: "PAID",
    sections: ["HERO", "PACKAGES", "REVIEWS", "GALLERY", "DESTINATIONS", "TEXTBLOCK"],
  },
  {
    id: "family-adventures",
    name: "Family Adventures",
    description: "Bright and approachable, built for family-friendly trips.",
    variant: "PLAYFUL",
    tier: "PAID",
    sections: ["TOPBAR", "HERO", "CATEGORIES", "PACKAGES", "GALLERY", "REVIEWS"],
  },
];

export const DEFAULT_TEMPLATE = SITE_TEMPLATES[0];

export function findTemplate(id: string): SiteTemplateDefinition | null {
  return SITE_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * `true` when `tier` may use `template`.
 *
 * Every tier may use a `"FREE"` template; a `"PAID"` template needs any tier
 * above `FREE` — the same "whole feature, not a field nuance" cut `isPaidTier`
 * makes for custom domains, applied here as a per-field service check instead
 * of a whole-endpoint gate because a FREE-tier agency can still edit its
 * sections and save the rest of the page-builder screen; it just can't switch
 * to a paid starter template.
 */
export function allowsTemplate(tier: string, template: SiteTemplateDefinition): boolean {
  return template.tier === "FREE" || tier !== "FREE";
}

/* ── 3. Header / footer chrome ───────────────────────────────────────────── */

export type SitePageHeaderStyleId = "STANDARD" | "CENTERED" | "CTA";

export const HEADER_STYLES: readonly { value: SitePageHeaderStyleId; label: string }[] = [
  { value: "STANDARD", label: "Logo Left, Nav Right" },
  { value: "CENTERED", label: "Centered Logo" },
  { value: "CTA", label: "Nav + Call-to-Action Button" },
];

export const HEADER_STYLE_IDS = HEADER_STYLES.map((h) => h.value) as SitePageHeaderStyleId[];

export type SitePageFooterStyleId = "BASIC" | "DETAILED" | "GRID" | "LOGO_GRID";

export const FOOTER_STYLES: readonly { value: SitePageFooterStyleId; label: string }[] = [
  { value: "BASIC", label: "Basic Footer" },
  { value: "DETAILED", label: "Detailed Footer" },
  { value: "GRID", label: "Grid Footer" },
  { value: "LOGO_GRID", label: "Logo Bottom Grid Footer" },
];

export const FOOTER_STYLE_IDS = FOOTER_STYLES.map((f) => f.value) as SitePageFooterStyleId[];

export const DEFAULT_HEADER = {
  style: "STANDARD" as SitePageHeaderStyleId,
  ctaText: "Book Now",
  ctaLink: "/packages",
  sticky: true,
};

export const DEFAULT_FOOTER = {
  style: "BASIC" as SitePageFooterStyleId,
};

/* ── 4. Hero height / marquee direction ──────────────────────────────────── */

export type SitePageHeroHeightId = "SMALL" | "MEDIUM" | "LARGE" | "FULL";
export const HERO_HEIGHTS: readonly SitePageHeroHeightId[] = ["SMALL", "MEDIUM", "LARGE", "FULL"];

export type SitePageMarqueeDirectionId = "LTR" | "RTL";
export const MARQUEE_DIRECTIONS: readonly SitePageMarqueeDirectionId[] = ["LTR", "RTL"];

/** Row-sharing width — two consecutive sections both under 100 share one row. */
export const WIDTH_PERCENT_OPTIONS: readonly number[] = [25, 50, 75, 100];

/* ── 5. Shape limits ─────────────────────────────────────────────────────── */

/**
 * A generous ceiling on how many sections one page may have — not a number
 * the frontend prototype states (it has no cap at all), but basic data-
 * integrity hygiene of the kind every module in this pass applies somewhere
 * (Day 3's `MAX_TOP_LEVEL_ITEMS`, Day 2's `MAX_POPUP_DELAY_SECONDS`): a
 * single page does not usefully have hundreds of blocks, and without a limit
 * a buggy client could PATCH an unbounded array in a single request.
 */
export const MAX_SECTIONS = 40;

/** Curated picks per data-section — mirrors `MAX_SECTIONS`' reasoning. */
export const MAX_SELECTED_IDS = 24;

export const SITE_PAGE_TEXT_LIMITS = {
  name: { max: 80 },
  title: { max: 120 },
  subtitle: { max: 200 },
  text: { max: 2000 },
  ctaText: { max: 40 },
  adPosition: { max: 60 },
  selectedId: { max: 100 },
} as const;

export const SITE_PAGE_NUMBER_LIMITS = {
  fontSize: { min: 10, max: 72 },
  /** Marquee seconds-per-pass. */
  speed: { min: 5, max: 120 },
  spacing: { min: 0, max: 200 },
  itemCount: { min: 1, max: 24 },
  cardSize: { min: 40, max: 1000 },
} as const;

/** Link length ceiling, reused from Day 2 rather than re-picked — one number
 * for "how long is a URL allowed to be" across the whole white-label feature
 * set. */
export const MAX_LINK_LENGTH = SITE_TEXT_LIMITS.url.max;

/**
 * `true` when `value` is safe to store as a section/header link.
 *
 * Unlike Day 3's navigation items, a section's `link`/`ctaLink2` (and the
 * header's `ctaLink`) carry no separate `linkType` field in the frontend
 * prototype's `Section` shape — the same string might be an internal path or
 * a full external URL. So this accepts either, deferring to the same two
 * safety checks Day 2 and Day 3 already established rather than inventing a
 * third: `isSafeInternalPath` for a leading `/`, `isSafeLinkUrl` for
 * everything else.
 */
export function isSafeSiteLink(value: string): boolean {
  if (value.length > MAX_LINK_LENGTH) return false;
  if (value.startsWith("/")) return isSafeInternalPath(value);
  return isSafeLinkUrl(value);
}

/* ── 6. Per-section-type defaults ────────────────────────────────────────── */

/** Fields every section carries regardless of type, mirroring the frontend
 * prototype's `SECTION_BASE_DEFAULTS`. */
export const SECTION_BASE_DEFAULTS = {
  widthPercent: 100,
  useThemeBg: true,
  useThemeText: true,
  overlayEnabled: false,
};

/** The subset of a section's fields a fresh, type-specific seed may set. */
export interface SectionSeedDefaults {
  title?: string;
  text?: string;
  subtitle?: string;
  ctaText?: string;
  heroHeight?: SitePageHeroHeightId;
  speed?: number;
  direction?: SitePageMarqueeDirectionId;
  itemCount?: number;
}

/** A fresh section's type-specific seed values, applied on top of the base
 * defaults above — the server-side counterpart of the prototype's
 * `createSection(type)`. */
export function sectionDefaultsFor(type: SitePageSectionTypeId): SectionSeedDefaults {
  switch (type) {
    case "HERO":
      return { title: "Adventure Awaits", subtitle: "Discover unforgettable treks.", heroHeight: "LARGE", ctaText: "Explore Packages" };
    case "TOPBAR":
      return { text: "Book your next adventure today!", speed: 20, direction: "LTR" };
    case "CATEGORIES":
      return { title: "Popular Categories" };
    case "TEXTBLOCK":
      return { title: "About Us", text: "Tell your story here." };
    case "PACKAGES":
      return { title: "Featured Packages", itemCount: 6 };
    case "DESTINATIONS":
      return { title: "Top Destinations", itemCount: 6 };
    case "BLOGS":
      return { title: "From the Blog", itemCount: 3 };
    case "GALLERY":
      return { title: "Gallery", itemCount: 8 };
    case "VIDEOS":
      return { title: "Videos", itemCount: 4 };
    case "REVIEWS":
      return { title: "What Trekkers Say", itemCount: 6 };
    case "ADS":
      return {};
    default:
      return {};
  }
}

/* ── 7. Tier gating re-export ────────────────────────────────────────────── */

export type { TierName };
