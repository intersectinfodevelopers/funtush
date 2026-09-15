/**
 * ── Request validation for the page-builder endpoints (backend catch-up pass,
 * Phase 8) ────────────────────────────────────────────────────────────────
 *
 * Same split every White-label-week module uses: this file answers "is this
 * request well-formed" (shape, lengths, link safety); `sitePage.service.ts`
 * answers "is this agency allowed to" (paid-template gating, which needs a
 * database read for the tier and so cannot live in zod).
 *
 * Two schemas, not one, because the page-builder has two genuinely different
 * write operations (see `sitePage.service.ts`'s file header for why they are
 * not the same endpoint): `sitePageUpdateSchema` edits the page in place —
 * chrome fields merge like every other PATCH in this pass, `sections` is a
 * full replace when sent, same as Day 3's `items` — and `applyTemplateSchema`
 * is the single-field, deliberately narrow body for "start over from this
 * template."
 */

import { z } from "zod";
import {
  FOOTER_STYLE_IDS,
  HEADER_STYLE_IDS,
  HERO_HEIGHTS,
  MARQUEE_DIRECTIONS,
  MAX_LINK_LENGTH,
  MAX_SECTIONS,
  MAX_SELECTED_IDS,
  SECTION_TYPE_IDS,
  SITE_PAGE_NUMBER_LIMITS,
  SITE_PAGE_TEXT_LIMITS,
  SITE_TEMPLATES,
  SITE_VARIANTS,
  WIDTH_PERCENT_OPTIONS,
  isSafeSiteLink,
} from "../data/sitePage";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Free text rendered on a public page — same defence-in-depth every White-
 * label-week module applies: `<`/`>` are rejected here even though the
 * renderer must still escape whatever it prints.
 */
function safeText(field: string, max: number, min = 0) {
  let schema = z.string().trim().max(max, `${field} must be at most ${max} characters`);
  if (min > 0) schema = schema.min(min, `${field} must be at least ${min} character(s)`);
  return schema.refine((value) => !/[<>]/.test(value), { message: `${field} must not contain < or >` });
}

function safeLink(field: string) {
  return z
    .string()
    .trim()
    .max(MAX_LINK_LENGTH, `${field} is too long`)
    .refine((value) => value === "" || isSafeSiteLink(value), {
      message: `${field} must be a path on your own site (starting with /) or a full http:// or https:// address`,
    });
}

const hexColor = z.string().trim().regex(HEX_COLOR, "Must be a hex value like #0F766E");

/**
 * One section, sent in full every time it appears in the array — see the
 * file header on why there is no per-field PATCH inside one section.
 *
 * Every field is optional and applies regardless of `type`, mirroring the
 * frontend prototype's own flat `Section` struct exactly: the *type* decides
 * which fields the editor shows and the renderer reads, not which fields the
 * schema accepts. Validating "only send `speed` for a topbar" would reject a
 * perfectly harmless leftover value from a section that changed type, for no
 * safety benefit — the renderer already ignores fields its type doesn't use.
 */
const sitePageSectionSchema = z
  .object({
    type: z.enum(SECTION_TYPE_IDS as [string, ...string[]]),

    title: safeText("Title", SITE_PAGE_TEXT_LIMITS.title.max).nullable().optional(),
    text: safeText("Text", SITE_PAGE_TEXT_LIMITS.text.max).nullable().optional(),
    subtitle: safeText("Subtitle", SITE_PAGE_TEXT_LIMITS.subtitle.max).nullable().optional(),
    image: z.string().trim().max(MAX_LINK_LENGTH, "Image URL is too long").nullable().optional(),
    link: safeLink("Link").nullable().optional(),
    ctaText: safeText("Button label", SITE_PAGE_TEXT_LIMITS.ctaText.max).nullable().optional(),
    ctaText2: safeText("Second button label", SITE_PAGE_TEXT_LIMITS.ctaText.max).nullable().optional(),
    ctaLink2: safeLink("Second button link").nullable().optional(),

    heroHeight: z.enum(HERO_HEIGHTS as [string, ...string[]]).nullable().optional(),
    overlayEnabled: z.boolean().optional(),

    fontSize: z
      .number()
      .int()
      .min(SITE_PAGE_NUMBER_LIMITS.fontSize.min)
      .max(SITE_PAGE_NUMBER_LIMITS.fontSize.max)
      .nullable()
      .optional(),
    speed: z
      .number()
      .int()
      .min(SITE_PAGE_NUMBER_LIMITS.speed.min)
      .max(SITE_PAGE_NUMBER_LIMITS.speed.max)
      .nullable()
      .optional(),
    direction: z.enum(MARQUEE_DIRECTIONS as [string, ...string[]]).nullable().optional(),

    useThemeBg: z.boolean().optional(),
    bgColor: hexColor.nullable().optional(),
    useThemeText: z.boolean().optional(),
    textColor: hexColor.nullable().optional(),

    spacingTop: z
      .number()
      .int()
      .min(SITE_PAGE_NUMBER_LIMITS.spacing.min)
      .max(SITE_PAGE_NUMBER_LIMITS.spacing.max)
      .nullable()
      .optional(),
    spacingBottom: z
      .number()
      .int()
      .min(SITE_PAGE_NUMBER_LIMITS.spacing.min)
      .max(SITE_PAGE_NUMBER_LIMITS.spacing.max)
      .nullable()
      .optional(),

    itemCount: z
      .number()
      .int()
      .min(SITE_PAGE_NUMBER_LIMITS.itemCount.min)
      .max(SITE_PAGE_NUMBER_LIMITS.itemCount.max)
      .nullable()
      .optional(),
    selectedIds: z
      .array(z.string().trim().min(1).max(SITE_PAGE_TEXT_LIMITS.selectedId.max))
      .max(MAX_SELECTED_IDS, `At most ${MAX_SELECTED_IDS} items may be featured in one section`)
      .optional(),

    cardWidth: z
      .number()
      .int()
      .min(SITE_PAGE_NUMBER_LIMITS.cardSize.min)
      .max(SITE_PAGE_NUMBER_LIMITS.cardSize.max)
      .nullable()
      .optional(),
    cardHeight: z
      .number()
      .int()
      .min(SITE_PAGE_NUMBER_LIMITS.cardSize.min)
      .max(SITE_PAGE_NUMBER_LIMITS.cardSize.max)
      .nullable()
      .optional(),

    adPosition: safeText("Ad position", SITE_PAGE_TEXT_LIMITS.adPosition.max).nullable().optional(),

    widthPercent: z
      .number()
      .refine((v) => (WIDTH_PERCENT_OPTIONS as readonly number[]).includes(v), {
        message: `Width must be one of ${WIDTH_PERCENT_OPTIONS.join(", ")}`,
      })
      .optional(),
  })
  .strict();

export const sitePageUpdateSchema = z
  .object({
    variant: z.enum(SITE_VARIANTS as [string, ...string[]]).optional(),
    name: safeText("Site name", SITE_PAGE_TEXT_LIMITS.name.max).nullable().optional(),

    headerStyle: z.enum(HEADER_STYLE_IDS as [string, ...string[]]).optional(),
    headerCtaText: safeText("Header button label", SITE_PAGE_TEXT_LIMITS.ctaText.max).nullable().optional(),
    headerCtaLink: safeLink("Header button link").nullable().optional(),
    headerSticky: z.boolean().optional(),

    footerStyle: z.enum(FOOTER_STYLE_IDS as [string, ...string[]]).optional(),

    /**
     * The whole section list, in its final order. Present ⇒ replace every
     * stored section with this list, positions renumbered from the array's
     * order. Absent ⇒ leave the stored sections untouched — the same "a key
     * you did not send does not change anything" PATCH rule every sibling
     * module uses, applied to a list instead of a scalar (Day 3's `items`).
     */
    sections: z.array(sitePageSectionSchema).max(MAX_SECTIONS, `A page may have at most ${MAX_SECTIONS} sections`).optional(),
  })
  .strict();

/**
 * `POST /agencies/me/site-page/apply-template` — deliberately its own, tiny
 * schema rather than folding `templateId` into the PATCH above. Applying a
 * template **replaces** the section list (see the service), and that is
 * destructive enough — the frontend prototype itself gates it behind a
 * confirmation dialog — that it deserves an endpoint whose entire body is
 * "which template", not a field that could be set almost by accident
 * alongside an unrelated header-style tweak in the same PATCH.
 */
export const applyTemplateSchema = z
  .object({
    templateId: z.string().refine((id) => SITE_TEMPLATES.some((t) => t.id === id), {
      message: "Unknown template id",
    }),
  })
  .strict();

export type SitePageSectionInput = z.infer<typeof sitePageSectionSchema>;
export type SitePageUpdateInput = z.infer<typeof sitePageUpdateSchema>;
export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>;
