/**
 * ── Request validation for the branding endpoint (White-label week · Day 1) ──
 *
 * Two layers of checking exist for branding, and it is worth being clear about
 * which lives where, because putting a rule in the wrong layer is how rules end
 * up enforced twice or not at all:
 *
 *   **This file (zod)** answers *"is this request well-formed?"* — the shape of
 *   the body, the types, the ranges, and membership of the fixed whitelists
 *   (fonts, ratios, currencies, palette ids). None of that needs the database.
 *
 *   **`branding.service.ts`** answers *"is this agency allowed to do this?"* —
 *   the tier rule (`SMALL` may not free-pick a colour) and the image dimension
 *   rules. Those need a DB read or the file bytes, so they cannot live here.
 *
 * The practical upshot: a request that fails here gets a 400 without a single
 * query being run.
 */

import { z } from "zod";
import {
  BRAND_CURRENCIES,
  BRAND_FONTS,
  BRAND_PALETTE,
  CARD_IMAGE_RATIO_IDS,
  MAX_CURRENCY_SYMBOL_LENGTH,
  MAX_LOGO_WIDTH,
  MAX_RECEIPT_FOOTER_LENGTH,
  MIN_LOGO_WIDTH,
} from "../data/brandTheme";

/**
 * `#RRGGBB`, uppercase or lowercase, exactly six digits.
 *
 * Three-digit shorthand (`#0F7`) is deliberately rejected. It is valid CSS, but
 * accepting both forms means `#0F7` and `#00FF77` are the same colour stored two
 * ways, and then "is this colour one of our curated swatches?" needs a
 * normalisation step that someone will forget. One canonical form, checked once.
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Ids pulled from the data tables so the schema can never drift from them. */
const PALETTE_IDS = BRAND_PALETTE.map((swatch) => swatch.id);
const FONT_IDS = BRAND_FONTS.map((font) => font.id);
const CURRENCY_CODES = BRAND_CURRENCIES.map((currency) => currency.code);

export const brandingUpdateSchema = z
  .object({
    /**
     * `.trim()` runs before the length checks, so a name of three spaces is
     * caught as empty rather than stored as `"   "` and rendered as a blank
     * header.
     */
    brandName: z
      .string()
      .trim()
      .min(2, "Brand name must be at least 2 characters")
      .max(60, "Brand name must be at most 60 characters")
      .optional(),

    primaryColor: z
      .string()
      .trim()
      .regex(HEX_COLOR, "Primary color must be a hex value like #0F766E")
      /**
       * Normalise to uppercase at the edge, so everything downstream — the tier
       * check, the swatch lookup, the stored row — compares plain strings.
       */
      .transform((value) => value.toUpperCase())
      .optional(),

    paletteId: z
      .string()
      .trim()
      .refine((id) => PALETTE_IDS.includes(id), {
        message: `Unknown palette id. Allowed: ${PALETTE_IDS.join(", ")}`,
      })
      .optional(),

    fontFamily: z
      .string()
      .trim()
      .refine((id) => FONT_IDS.includes(id), {
        message: `Unknown font. Allowed: ${FONT_IDS.join(", ")}`,
      })
      .optional(),

    cardImageRatio: z
      .string()
      .trim()
      .refine((id) => (CARD_IMAGE_RATIO_IDS as string[]).includes(id), {
        message: `Unknown image ratio. Allowed: ${CARD_IMAGE_RATIO_IDS.join(", ")}`,
      })
      .optional(),

    currencyCode: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((code) => CURRENCY_CODES.includes(code), {
        message: `Unsupported currency. Allowed: ${CURRENCY_CODES.join(", ")}`,
      })
      .optional(),

    /**
     * The custom glyph. `.nullable()` matters here and nowhere else in this
     * schema: sending `null` is how an agency says *"drop my override, go back
     * to the table's symbol"*. Omitting the key means "leave it as it is". Those
     * are different intentions and the API has to be able to express both.
     */
    currencySymbol: z
      .string()
      .trim()
      .min(1, "Currency symbol cannot be empty")
      .max(
        MAX_CURRENCY_SYMBOL_LENGTH,
        `Currency symbol must be at most ${MAX_CURRENCY_SYMBOL_LENGTH} characters`,
      )
      /**
       * A symbol is printed straight into a price label. Angle brackets,
       * quotes, ampersands and backslashes have no business in a currency glyph
       * and every business in an injection payload.
       */
      .refine((symbol) => !/[<>&"'`\\]/.test(symbol), {
        message: "Currency symbol contains invalid characters",
      })
      .nullable()
      .optional(),

    currencyDisplay: z.enum(["SYMBOL", "CODE", "SYMBOL_CODE"]).optional(),

    /**
     * `z.coerce.number()` and not `z.number()` — this endpoint accepts both a
     * plain JSON body and `multipart/form-data` (when a logo/favicon file
     * rides along), and every multipart field arrives as a string. Coercing
     * means `"180"` and `180` both validate the same way; a bare `z.number()`
     * would 400 every multipart save that also touched this field.
     */
    logoWidth: z.coerce
      .number()
      .int("Logo width must be a whole number of pixels")
      .min(MIN_LOGO_WIDTH, `Logo width must be at least ${MIN_LOGO_WIDTH}px`)
      .max(MAX_LOGO_WIDTH, `Logo width must be at most ${MAX_LOGO_WIDTH}px`)
      .optional(),

    /**
     * `.nullable()`, same reasoning as `currencySymbol` above: `null` clears
     * the override back to the platform default line, omitting the key leaves
     * it alone. Empty string is left legal (an agency printing no footer line
     * at all is a real choice, not an error).
     */
    receiptFooter: z
      .string()
      .trim()
      .max(
        MAX_RECEIPT_FOOTER_LENGTH,
        `Receipt footer must be at most ${MAX_RECEIPT_FOOTER_LENGTH} characters`,
      )
      .refine((value) => !/[<>]/.test(value), {
        message: "Receipt footer must not contain < or >",
      })
      .nullable()
      .optional(),
  })
  /**
   * Reject anything not listed above instead of silently dropping it.
   *
   * Zod's default is to strip unknown keys. That is the wrong default for a
   * settings endpoint: an agency that PATCHes `{"primaryColour": "#FF0000"}`
   * (British spelling) would get `200 OK` and no colour change, and would file a
   * bug saying "saving does nothing". `.strict()` turns that into a 400 naming
   * the offending key.
   */
  .strict();

export type BrandingUpdateInput = z.infer<typeof brandingUpdateSchema>;
