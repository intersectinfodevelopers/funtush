/**
 * ── The brand-identity option tables (White-label week · Day 1) ──────────────
 *
 * Everything an agency is *allowed* to choose when it brands its white-label
 * site lives in this one file: the curated colour swatches, the font whitelist,
 * the thumbnail aspect ratios, the currency table, and the two image specs.
 *
 * **Why a source file and not database rows?**
 *
 * Same reasoning as the emergency-number table (Mobile week · Day 4), minus the
 * life-safety part:
 *
 *   - There is **no tenant dimension**. Every agency sees the same swatches and
 *     the same font list. Data with no `agency_id` is configuration, not data.
 *   - These values are **referenced by code**, not just displayed. The service
 *     validates `primaryColor` against `BRAND_PALETTE`; the renderer maps
 *     `fontFamily` to a real CSS stack. If the list lived in Postgres, a row
 *     could name a font the CSS layer has never heard of and the site would
 *     silently render in Times New Roman.
 *   - Changing a swatch changes how live customer sites look. That deserves a
 *     pull request and a reviewer, not an `UPDATE` in a admin panel.
 *
 * The cost, stated honestly: adding a font or a currency needs a deploy. For a
 * list that changes maybe twice a year that is the right trade.
 *
 * ⚠️ This file must not import anything from `@funtush/database`. It is pulled
 * in by the validation layer, which runs before any DB call, and by tests that
 * deliberately run with no database at all.
 */

/* ── 1. Tiers ────────────────────────────────────────────────────────────── */

/**
 * The tier names as they exist in `subscription_tiers.name` (see
 * `packages/database/prisma/seed.ts`). `FREE` is the row the 30-day trial
 * account sits on.
 */
export type TierName = "FREE" | "SMALL" | "MEDIUM" | "LARGE";

/**
 * Tiers allowed to type in **any** hex colour they like.
 *
 * Day 1's rule, straight from the task: *curated palette for Small, free picker
 * for Medium and Large*. SMALL and FREE therefore pick from `BRAND_PALETTE`.
 *
 * Why cap SMALL at a curated list at all? Two reasons, one commercial and one
 * technical. Commercially it is a visible reason to upgrade. Technically, a
 * curated swatch is a colour we have already checked for contrast against white
 * text — a Small-tier agency that types `#FFFF00` gets an unreadable site and
 * blames the platform, not itself.
 *
 * The trial (FREE) gets the full Small feature set per Backend Guide §0.1, so it
 * is treated exactly like SMALL here.
 */
export const FREE_COLOR_PICKER_TIERS: readonly TierName[] = ["MEDIUM", "LARGE"];

/** `true` when this tier may set an arbitrary `primaryColor`. */
export function allowsFreeColorPicker(tier: string): boolean {
  return FREE_COLOR_PICKER_TIERS.includes(tier as TierName);
}

/* ── 2. The curated palette ──────────────────────────────────────────────── */

export interface PaletteSwatch {
  /** Stable machine key. Never renamed — it is stored in the database. */
  id: string;
  /** Shown in the picker UI. Safe to reword. */
  label: string;
  /** Uppercase 6-digit hex, `#RRGGBB`. */
  hex: string;
  /**
   * The colour text must be in when placed **on** `hex` — black or white,
   * whichever passes WCAG AA. Precomputed here so neither the API nor the
   * front-end has to do luminance maths at render time, and so the answer is
   * identical everywhere.
   */
  onColor: "#FFFFFF" | "#111827";
}

/**
 * Twelve swatches spanning the colour wheel. Each one was checked to give at
 * least a 4.5:1 contrast ratio against its `onColor`, so a button in any of
 * these colours is readable by the standard WCAG AA measure.
 *
 * Keep the ids stable: they are written into `agency_branding.palette_id`, so
 * renaming `teal` to `teal-700` would orphan every row that already picked it.
 */
export const BRAND_PALETTE: readonly PaletteSwatch[] = [
  { id: "teal", label: "Himalayan Teal", hex: "#0F766E", onColor: "#FFFFFF" },
  { id: "forest", label: "Forest", hex: "#166534", onColor: "#FFFFFF" },
  { id: "moss", label: "Moss", hex: "#4D7C0F", onColor: "#FFFFFF" },
  { id: "ocean", label: "Ocean", hex: "#0369A1", onColor: "#FFFFFF" },
  { id: "indigo", label: "Indigo", hex: "#4338CA", onColor: "#FFFFFF" },
  { id: "violet", label: "Violet", hex: "#6D28D9", onColor: "#FFFFFF" },
  { id: "plum", label: "Plum", hex: "#9D174D", onColor: "#FFFFFF" },
  { id: "crimson", label: "Crimson", hex: "#B91C1C", onColor: "#FFFFFF" },
  { id: "sunset", label: "Sunset", hex: "#C2410C", onColor: "#FFFFFF" },
  { id: "amber", label: "Amber", hex: "#B45309", onColor: "#FFFFFF" },
  { id: "slate", label: "Slate", hex: "#334155", onColor: "#FFFFFF" },
  { id: "charcoal", label: "Charcoal", hex: "#1F2937", onColor: "#FFFFFF" },
];

/** Look a swatch up by id. `null` when the id is not one of ours. */
export function findSwatch(id: string): PaletteSwatch | null {
  return BRAND_PALETTE.find((swatch) => swatch.id === id) ?? null;
}

/** Look a swatch up by colour. Used to tag a free-picked colour that happens to match. */
export function findSwatchByHex(hex: string): PaletteSwatch | null {
  const upper = hex.toUpperCase();
  return BRAND_PALETTE.find((swatch) => swatch.hex === upper) ?? null;
}

/* ── 3. Fonts ───────────────────────────────────────────────────────────── */

export interface BrandFont {
  /** Stored key. */
  id: string;
  /** Shown in the picker. */
  label: string;
  /**
   * The complete CSS `font-family` value, fallbacks included. The agency never
   * supplies this — it picks an `id` and the server looks the stack up.
   *
   * This indirection is a security boundary, not a nicety. `font-family` is
   * emitted into a `<style>` block on the white-label page. If an agency could
   * store the raw string, it could store
   * `Arial; } body { display:none } .x {` and break — or deface — its own
   * public site, and any XSS filter you then bolt on is a filter you have to
   * get right forever. A whitelist of ids can only ever produce one of six
   * known-good strings.
   */
  stack: string;
  /** `sans` fonts for UI, `serif` for editorial brands — used to group the picker. */
  category: "sans" | "serif";
}

export const BRAND_FONTS: readonly BrandFont[] = [
  {
    id: "inter",
    label: "Inter",
    stack: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    category: "sans",
  },
  {
    id: "system",
    label: "System Default",
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    category: "sans",
  },
  {
    id: "poppins",
    label: "Poppins",
    stack: "'Poppins', system-ui, sans-serif",
    category: "sans",
  },
  {
    id: "montserrat",
    label: "Montserrat",
    stack: "'Montserrat', system-ui, sans-serif",
    category: "sans",
  },
  {
    id: "merriweather",
    label: "Merriweather",
    stack: "'Merriweather', Georgia, 'Times New Roman', serif",
    category: "serif",
  },
  {
    id: "lora",
    label: "Lora",
    stack: "'Lora', Georgia, 'Times New Roman', serif",
    category: "serif",
  },
];

export function findFont(id: string): BrandFont | null {
  return BRAND_FONTS.find((font) => font.id === id) ?? null;
}

/* ── 4. Package-card thumbnail ratios ───────────────────────────────────── */

/**
 * The three ratios the task names. `value` is the string CSS's `aspect-ratio`
 * property understands, so the renderer can drop it straight into a stylesheet.
 * `width`/`height` are there for the image pipeline, which needs numbers to
 * crop with.
 */
export const CARD_IMAGE_RATIOS = {
  RATIO_1_1: { id: "RATIO_1_1", label: "Square (1:1)", value: "1 / 1", width: 1, height: 1 },
  RATIO_4_3: { id: "RATIO_4_3", label: "Classic (4:3)", value: "4 / 3", width: 4, height: 3 },
  RATIO_16_9: { id: "RATIO_16_9", label: "Wide (16:9)", value: "16 / 9", width: 16, height: 9 },
} as const;

export type CardImageRatioId = keyof typeof CARD_IMAGE_RATIOS;

export const CARD_IMAGE_RATIO_IDS = Object.keys(CARD_IMAGE_RATIOS) as CardImageRatioId[];

/* ── 5. Currency indicator ──────────────────────────────────────────────── */

export interface BrandCurrency {
  /** ISO 4217 code — the stored value. */
  code: string;
  /** Default glyph. An agency may override it (`रु` for `Rs`). */
  symbol: string;
  label: string;
}

/**
 * The currencies a Nepali trekking agency realistically prices in. Small on
 * purpose: an agency that needs a currency not on this list is a support
 * conversation, not a free-text field that lets someone store `<script>` as a
 * currency code.
 */
export const BRAND_CURRENCIES: readonly BrandCurrency[] = [
  { code: "NPR", symbol: "Rs", label: "Nepalese Rupee" },
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar" },
  { code: "INR", symbol: "₹", label: "Indian Rupee" },
  { code: "CNY", symbol: "¥", label: "Chinese Yuan" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen" },
];

export function findCurrency(code: string): BrandCurrency | null {
  const upper = code.toUpperCase();
  return BRAND_CURRENCIES.find((currency) => currency.code === upper) ?? null;
}

/**
 * How many characters an agency's custom symbol may be.
 *
 * Four, because the longest legitimate symbol in use is three (`CHF`, `A$` plus
 * a space) and anything longer is either a mistake or an attempt to smuggle
 * markup into a price label.
 */
export const MAX_CURRENCY_SYMBOL_LENGTH = 4;

/* ── 6. Image specs ─────────────────────────────────────────────────────── */

export interface ImageSpec {
  /** Human name used in error messages. */
  label: string;
  /** Required width in pixels. Exact — not a maximum. */
  width: number;
  /** Required height in pixels. Exact. */
  height: number;
  /** Upload size ceiling, bytes. */
  maxBytes: number;
  /** MIME types accepted for this particular slot. */
  mimeTypes: readonly string[];
}

/**
 * Header logo — **exactly 725 × 145 px**.
 *
 * Why exact rather than "at most"? Because the header is a fixed-height strip on
 * every page of the white-label site. If one agency uploads a 2000 × 200 image
 * and another a 300 × 300, the renderer has to scale them, and scaled logos go
 * blurry or letterboxed in ways the agency then reports as a bug. Rejecting the
 * upload with "resize to 725 × 145" moves a problem that would surface as a
 * fuzzy logo on a live site into a clear message on a settings screen.
 *
 * PDFs are excluded even though the shared multer filter allows them — a PDF is
 * a valid document upload but never a valid logo.
 */
export const LOGO_SPEC: ImageSpec = {
  label: "Logo",
  width: 725,
  height: 145,
  maxBytes: 2 * 1024 * 1024,
  mimeTypes: ["image/png", "image/webp", "image/jpeg"],
};

/**
 * Favicon — **exactly 96 × 96 px**.
 *
 * 96 is the largest size browsers request for a tab icon on a high-DPI display;
 * they downscale it themselves for the 16 px and 32 px slots. Uploading exactly
 * 96 means the browser always downscales, never upscales, so the icon stays
 * sharp.
 */
export const FAVICON_SPEC: ImageSpec = {
  label: "Favicon",
  width: 96,
  height: 96,
  maxBytes: 512 * 1024,
  mimeTypes: ["image/png", "image/webp"],
};

/* ── 6b. Logo display width (backend catch-up pass) ─────────────────────── */

/**
 * How large the uploaded logo is *shown*, in the header and footer — separate
 * from `LOGO_SPEC` above, which governs the *uploaded file's* pixel dimensions.
 *
 * These two do not conflict, and it is worth spelling out why not. `LOGO_SPEC`
 * exists so every agency uploads the same fixed-resolution source (725 × 145),
 * which is what keeps a scaled-up, blurry logo off the header entirely. This
 * display width only ever scales that source **down** for layout — `MAX_LOGO_
 * WIDTH` is kept well under 725px specifically so a display width can never
 * upscale the image, which is the only direction that causes blur. A theme
 * with a narrower header simply shows a smaller, still-sharp logo.
 */
export const MIN_LOGO_WIDTH = 40;
export const MAX_LOGO_WIDTH = 280;

/* ── 6c. Receipt footer (backend catch-up pass) ──────────────────────────── */

/**
 * A line or two of free text printed at the bottom of every POS receipt and
 * invoice — "Thank you for trekking with us!", a return policy, a WiFi
 * password. 200 characters is generous for that without being an invitation
 * to paste a paragraph of terms and conditions onto a receipt.
 */
export const MAX_RECEIPT_FOOTER_LENGTH = 200;

/* ── 7. Defaults ────────────────────────────────────────────────────────── */

/**
 * What the white-label site renders with when an agency has never opened the
 * branding screen — which, on day one of a trial, is every agency.
 *
 * The renderer must never receive `null` for any of these. A site with no
 * primary colour is not "unstyled", it is broken, and a `null` reaching a CSS
 * variable produces the literal string `null` in a stylesheet.
 */
export const DEFAULT_BRANDING = {
  primaryColor: "#0F766E",
  paletteId: "teal",
  fontFamily: "inter",
  cardImageRatio: "RATIO_4_3" as CardImageRatioId,
  currencyCode: "NPR",
  currencyDisplay: "SYMBOL" as const,
  logoWidth: 140,
  receiptFooter: "Thank you for trekking with us!",
} as const;
