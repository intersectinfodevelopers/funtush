/**
 * ── Brand identity service (White-label week · Day 1) ────────────────────────
 *
 * Owns everything behind `PATCH /agencies/me/branding` and the public read the
 * white-label renderer performs on every page view.
 *
 * The file has four jobs, in the order a request meets them:
 *
 *   1. **Authorise the colour.** SMALL (and the trial, which is SMALL's feature
 *      set) must choose from the curated palette; MEDIUM and LARGE may type any
 *      hex. This is a *tier* rule, so it needs the agency's tier — which is why
 *      it lives here and not in the zod schema.
 *   2. **Validate the images.** Exact pixel dimensions, MIME, and byte size,
 *      read from the buffer **before** anything is sent to S3.
 *   3. **Persist.** One `upsert` — the row may not exist yet, and an agency that
 *      has never opened this screen has no branding row at all.
 *   4. **Resolve for rendering.** Turn a row full of nullable columns into a
 *      complete, never-null theme plus the CSS custom properties the site
 *      renders with. This is the step that makes the deliverable real: *"brand
 *      identity fields save and apply to white-label site rendering."*
 *
 * Multi-tenancy note (Backend Guide §4): every function here is keyed by
 * `agencyId` taken from the authenticated session, never from the request body.
 * There is no code path that lets an agency name another agency's id.
 */

import { db } from "@funtush/database";
import { uploadFile, deleteFile } from "@funtush/storage";
import { httpError } from "../utils/httpError";
import { readImageDimensions } from "../utils/imageDimensions";
import {
  BRAND_CURRENCIES,
  BRAND_FONTS,
  BRAND_PALETTE,
  CARD_IMAGE_RATIOS,
  DEFAULT_BRANDING,
  FAVICON_SPEC,
  LOGO_SPEC,
  MAX_LOGO_WIDTH,
  MAX_RECEIPT_FOOTER_LENGTH,
  MIN_LOGO_WIDTH,
  allowsFreeColorPicker,
  findCurrency,
  findFont,
  findSwatch,
  findSwatchByHex,
  type CardImageRatioId,
  type ImageSpec,
} from "../data/brandTheme";
import type { BrandingUpdateInput } from "../validations/branding.validation";
import {
  queueRegeneration,
  type RegenerationReceipt,
} from "./regeneration.service";

/* ── Types ───────────────────────────────────────────────────────────────── */

/** The two image slots this endpoint accepts, as multipart field names. */
export type BrandImageField = "logo" | "favicon";

/** What multer hands the controller: field name → array of (usually one) file. */
export type BrandImageFiles = Partial<Record<BrandImageField, Express.Multer.File[]>>;

/** Currency display modes, mirroring the Prisma enum. */
export type CurrencyDisplayMode = "SYMBOL" | "CODE" | "SYMBOL_CODE";

/**
 * A fully resolved theme: every field populated, nothing nullable except the two
 * image URLs (an agency genuinely may have no logo, and the renderer falls back
 * to a text wordmark).
 *
 * **Moved out on Day 2:** this interface used to carry `poweredByFuntush`,
 * computed as `tier !== "LARGE"`. Day 2's task states the rule properly — forced
 * on for the Free trial, hidden on every paid tier — and gives the agency a
 * stored preference, which makes the badge a *site configuration* value rather
 * than a theme value. It now lives in one place only, `resolveFuntushBadge` in
 * `data/siteConfig.ts`, and is served by `GET /site/:slug/config`. Two functions
 * answering one boolean is how a badge ends up rendering on one page and not the
 * next.
 */
export interface ResolvedBranding {
  brandName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  /** Black or white — whichever is readable on `primaryColor`. */
  onPrimaryColor: string;
  paletteId: string | null;
  fontFamily: string;
  /** The full CSS `font-family` stack for `fontFamily`. */
  fontStack: string;
  cardImageRatio: CardImageRatioId;
  /** The same ratio as a CSS `aspect-ratio` value, e.g. `"4 / 3"`. */
  cardImageRatioValue: string;
  currencyCode: string;
  currencySymbol: string;
  currencyDisplay: CurrencyDisplayMode;
  /** A worked example, e.g. `"Rs 1,200"` — so the settings UI can preview it. */
  currencyExample: string;
  /** `"curated"` or `"free"` — what this agency's tier allows. */
  colorPickerMode: "curated" | "free";
  /** Rendered logo width in px — see `MAX_LOGO_WIDTH` in `data/brandTheme.ts`. */
  logoWidth: number;
  /** Printed at the bottom of every POS receipt/invoice. Never `null` — falls
   * back to the platform's own thank-you line. */
  receiptFooter: string;
  updatedAt: Date | null;
}

/* ── 1. Tier lookup ──────────────────────────────────────────────────────── */

/**
 * Read the agency's tier name and public identity in one query.
 *
 * Kept as its own function because three entry points need it and because it is
 * the single place a missing agency turns into a 404.
 */
export async function getAgencyBrandContext(agencyId: string) {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      // Day 4: a mapped domain is a second live cache in front of the same site,
      // so every regeneration has to know about it. Selected here rather than in
      // a second query because every write path already calls this function.
      customDomain: true,
      tier: { select: { name: true } },
    },
  });

  if (!agency) throw httpError(404, "Agency not found");

  return {
    id: agency.id,
    name: agency.name,
    slug: agency.slug,
    status: agency.status,
    customDomain: agency.customDomain ?? null,
    // A tier row is required by the schema, but defaulting keeps a corrupt
    // fixture from crashing the branding screen — the strictest tier wins.
    tier: agency.tier?.name ?? "FREE",
  };
}

/* ── 2. The colour rule ──────────────────────────────────────────────────── */

/** What the colour part of a save resolves to once the tier rule is applied. */
export interface ResolvedColor {
  primaryColor: string;
  paletteId: string | null;
}

/**
 * Decide the stored colour from what the agency sent, subject to its tier.
 *
 * Precedence: **`paletteId` wins over `primaryColor`.** If a request carries
 * both, the swatch's own hex is used and any hex sent alongside is ignored
 * rather than trusted. The alternative — believing the client's hex because it
 * also named a swatch — is exactly the hole a SMALL-tier client would drive
 * through to set an arbitrary colour.
 *
 * Returns `null` when the request touched neither field, meaning "leave the
 * stored colour alone".
 */
export function resolveColorForTier(
  tier: string,
  input: Pick<BrandingUpdateInput, "primaryColor" | "paletteId">,
): ResolvedColor | null {
  if (input.paletteId) {
    // zod already checked membership; this re-check is what makes the function
    // safe to call from anywhere, not only from behind the validated route.
    const swatch = findSwatch(input.paletteId);
    if (!swatch) throw httpError(400, `Unknown palette id "${input.paletteId}"`);
    return { primaryColor: swatch.hex, paletteId: swatch.id };
  }

  if (input.primaryColor) {
    const hex = input.primaryColor.toUpperCase();

    if (allowsFreeColorPicker(tier)) {
      // MEDIUM / LARGE: anything goes. Still tag it if it happens to be one of
      // ours, so the settings UI shows the swatch as selected rather than
      // showing a custom colour that looks identical to a swatch.
      return { primaryColor: hex, paletteId: findSwatchByHex(hex)?.id ?? null };
    }

    // FREE / SMALL: the hex must *be* a curated swatch.
    const swatch = findSwatchByHex(hex);
    if (!swatch) {
      throw httpError(
        403,
        "Your plan includes the curated colour palette. Choose one of the provided colours, " +
          "or upgrade to Medium or Large to use a custom colour.",
      );
    }
    return { primaryColor: swatch.hex, paletteId: swatch.id };
  }

  return null;
}

/* ── 3. Image validation ─────────────────────────────────────────────────── */

/**
 * Check one uploaded image against its spec, then return its buffer's
 * dimensions.
 *
 * Every failure here is a **400 with an actionable message**. "Logo must be
 * exactly 725 × 145 px (received 800 × 160 px)" tells an agency what to do;
 * "Invalid image" does not, and generates a support ticket.
 *
 * Order of checks is chosen so the cheapest, most likely failure fires first:
 * MIME (a string compare), then size (a number compare), then dimensions (the
 * only one that has to parse bytes).
 */
export function assertValidBrandImage(file: Express.Multer.File, spec: ImageSpec): void {
  if (!spec.mimeTypes.includes(file.mimetype)) {
    throw httpError(
      400,
      `${spec.label} must be one of: ${spec.mimeTypes.join(", ")} (received ${file.mimetype})`,
    );
  }

  if (file.size > spec.maxBytes) {
    const limitKb = Math.round(spec.maxBytes / 1024);
    const actualKb = Math.round(file.size / 1024);
    throw httpError(400, `${spec.label} must be at most ${limitKb} KB (received ${actualKb} KB)`);
  }

  const dimensions = readImageDimensions(file.buffer);

  if (!dimensions) {
    // The MIME header claimed an image but the bytes are not one. This is the
    // check that catches a `.png` that is really a renamed text file — and, more
    // importantly, a file whose declared Content-Type was simply wrong.
    throw httpError(400, `${spec.label} is not a readable PNG, JPEG, WebP or GIF image`);
  }

  if (dimensions.width !== spec.width || dimensions.height !== spec.height) {
    throw httpError(
      400,
      `${spec.label} must be exactly ${spec.width} × ${spec.height} px ` +
        `(received ${dimensions.width} × ${dimensions.height} px)`,
    );
  }
}

/**
 * Remove a file that a save has just replaced.
 *
 * Failures are swallowed on purpose. The agency's new logo is already uploaded
 * and the database row is about to point at it; blowing up here would report a
 * failed save for an operation that succeeded, and would leave the *new* object
 * orphaned instead of the old one. A stale object in a bucket costs fractions of
 * a cent; a false "save failed" costs a support ticket.
 */
async function discardReplacedFile(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    await deleteFile(url);
  } catch (err) {
    console.warn("[branding] could not delete replaced file", url, err);
  }
}

/* ── 4. Resolution — row + defaults → renderable theme ──────────────────── */

/** The subset of an `AgencyBranding` row this module reads. */
export interface BrandingRow {
  brandName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  paletteId: string | null;
  fontFamily: string | null;
  cardImageRatio: string;
  currencyCode: string;
  currencySymbol: string | null;
  currencyDisplay: string;
  logoWidth: number | null;
  receiptFooter: string | null;
  updatedAt: Date;
}

/**
 * Decide whether black or white text is readable on a background colour.
 *
 * Uses relative luminance with the standard sRGB coefficients (0.2126 R,
 * 0.7152 G, 0.0722 B) — green contributes most to perceived brightness, blue
 * least, which is why a pure blue looks dark and a pure yellow looks light even
 * though both are "full intensity" in one channel.
 *
 * Curated swatches carry a precomputed `onColor`; this function exists for the
 * free-picker tiers, whose colour nobody has looked at.
 */
export function readableTextColor(hex: string): string {
  const value = hex.replace("#", "");
  const toLinear = (channel: number): number => {
    const srgb = channel / 255;
    // The sRGB transfer curve. Skipping it and using the raw channel value
    // misjudges mid-tones badly enough to pick white text on a mid-yellow.
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };

  const r = toLinear(parseInt(value.slice(0, 2), 16));
  const g = toLinear(parseInt(value.slice(2, 4), 16));
  const b = toLinear(parseInt(value.slice(4, 6), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // 0.179 is where contrast against white and contrast against black are equal.
  return luminance > 0.179 ? "#111827" : "#FFFFFF";
}

/** Format a sample price the way this agency's settings say prices are written. */
export function formatCurrencyExample(
  symbol: string,
  code: string,
  display: CurrencyDisplayMode,
  amount = 1200,
): string {
  const formatted = amount.toLocaleString("en-US");
  if (display === "CODE") return `${code} ${formatted}`;
  if (display === "SYMBOL_CODE") return `${symbol} ${formatted} ${code}`;
  return `${symbol} ${formatted}`;
}

/**
 * Turn a (possibly missing) row into a complete theme.
 *
 * `row` is `null` for an agency that has never saved branding — the trial
 * account on its first day. That case must produce a fully usable theme, not an
 * error, which is why every field falls back to `DEFAULT_BRANDING`.
 */
export function resolveBranding(
  agency: { name: string; tier: string },
  row: BrandingRow | null,
): ResolvedBranding {
  const primaryColor = row?.primaryColor ?? DEFAULT_BRANDING.primaryColor;
  const paletteId = row?.paletteId ?? (row?.primaryColor ? null : DEFAULT_BRANDING.paletteId);

  // Prefer the swatch's hand-checked `onColor`; compute one only for a custom
  // colour.
  const swatch = paletteId ? findSwatch(paletteId) : null;
  const onPrimaryColor =
    swatch && swatch.hex === primaryColor ? swatch.onColor : readableTextColor(primaryColor);

  const fontId = row?.fontFamily ?? DEFAULT_BRANDING.fontFamily;
  // `findFont` can return null if a font was retired from the whitelist after a
  // row already stored it. Falling back keeps those sites rendering.
  const font = findFont(fontId) ?? findFont(DEFAULT_BRANDING.fontFamily);

  const ratioId = (row?.cardImageRatio ?? DEFAULT_BRANDING.cardImageRatio) as CardImageRatioId;
  const ratio = CARD_IMAGE_RATIOS[ratioId] ?? CARD_IMAGE_RATIOS[DEFAULT_BRANDING.cardImageRatio];

  const currencyCode = row?.currencyCode ?? DEFAULT_BRANDING.currencyCode;
  const currency = findCurrency(currencyCode);
  // Explicit override first, then the table, then the code itself — so a price
  // is never rendered with an empty prefix.
  const currencySymbol = row?.currencySymbol ?? currency?.symbol ?? currencyCode;
  const currencyDisplay = (row?.currencyDisplay ??
    DEFAULT_BRANDING.currencyDisplay) as CurrencyDisplayMode;

  // Clamped, not just defaulted: a row saved under a wider allowed range in
  // the past must not hand the renderer a value outside today's bounds.
  const logoWidth = Math.min(
    Math.max(row?.logoWidth ?? DEFAULT_BRANDING.logoWidth, MIN_LOGO_WIDTH),
    MAX_LOGO_WIDTH,
  );

  return {
    brandName: row?.brandName ?? agency.name,
    logoUrl: row?.logoUrl ?? null,
    faviconUrl: row?.faviconUrl ?? null,
    primaryColor,
    onPrimaryColor,
    paletteId: row?.paletteId ?? null,
    fontFamily: font?.id ?? DEFAULT_BRANDING.fontFamily,
    fontStack: font?.stack ?? "system-ui, sans-serif",
    cardImageRatio: ratioId,
    cardImageRatioValue: ratio.value,
    currencyCode,
    currencySymbol,
    currencyDisplay,
    currencyExample: formatCurrencyExample(currencySymbol, currencyCode, currencyDisplay),
    colorPickerMode: allowsFreeColorPicker(agency.tier) ? "free" : "curated",
    logoWidth,
    receiptFooter: row?.receiptFooter ?? DEFAULT_BRANDING.receiptFooter,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * The CSS custom properties the white-label site renders with.
 *
 * Returning variables rather than a finished stylesheet is the whole trick: the
 * site's CSS is written once against `var(--brand-primary)`, and branding
 * becomes six declarations injected into the page head. No per-agency
 * stylesheet, no rebuild when a colour changes.
 *
 * Values are all server-derived — a hex that matched `/^#[0-9a-fA-F]{6}$/`, a
 * font stack from the whitelist, a ratio from a fixed table. Nothing an agency
 * typed reaches this object verbatim, which is what makes emitting it inside a
 * `<style>` block safe.
 */
export function brandingCssVariables(branding: ResolvedBranding): Record<string, string> {
  return {
    "--brand-primary": branding.primaryColor,
    "--brand-on-primary": branding.onPrimaryColor,
    "--brand-font": branding.fontStack,
    "--brand-card-ratio": branding.cardImageRatioValue,
    "--brand-logo-width": `${branding.logoWidth}px`,
  };
}

/** The same variables as a ready-to-inject `:root { … }` block. */
export function brandingStyleBlock(branding: ResolvedBranding): string {
  const declarations = Object.entries(brandingCssVariables(branding))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `:root {\n${declarations}\n}`;
}

/* ── 5. Reads ────────────────────────────────────────────────────────────── */

/** The agency's own branding, as the dashboard settings screen needs it. */
export async function getAgencyBranding(agencyId: string): Promise<ResolvedBranding> {
  const agency = await getAgencyBrandContext(agencyId);
  const row = await db.agencyBranding.findUnique({ where: { agencyId } });
  return resolveBranding(agency, row as BrandingRow | null);
}

/**
 * Branding for a public white-label site, looked up by the agency's subdomain
 * slug — the read `resolveTenant` performs before rendering a page.
 *
 * A `SUSPENDED` or `LOCKED` agency gets a **404**, not a 403. 403 would confirm
 * "this agency exists but is not paying", which is nobody's business but the
 * agency's; 404 is what a visitor to a site that is not currently published
 * should see. Same reasoning as the cross-tenant 404 in Mobile week Day 2.
 */
export async function getPublicBrandingBySlug(slug: string): Promise<
  ResolvedBranding & { agencySlug: string }
> {
  const agency = await db.agency.findUnique({
    where: { slug },
    select: {
      name: true,
      slug: true,
      status: true,
      tier: { select: { name: true } },
      branding: true,
    },
  });

  if (!agency) throw httpError(404, "Site not found");
  if (agency.status === "SUSPENDED" || agency.status === "LOCKED") {
    throw httpError(404, "Site not found");
  }

  const resolved = resolveBranding(
    { name: agency.name, tier: agency.tier?.name ?? "FREE" },
    agency.branding as BrandingRow | null,
  );

  return { ...resolved, agencySlug: agency.slug };
}

/**
 * Everything the settings screen needs to draw its pickers, filtered by tier.
 *
 * The palette is returned for **every** tier, not only the curated ones —
 * MEDIUM and LARGE still get the swatches as convenient presets, they are just
 * additionally allowed to ignore them. `colorPickerMode` is the flag the UI
 * uses to decide whether to render the free hex input at all.
 */
export async function getBrandingOptions(agencyId: string) {
  const agency = await getAgencyBrandContext(agencyId);

  return {
    tier: agency.tier,
    colorPickerMode: allowsFreeColorPicker(agency.tier) ? "free" : "curated",
    palette: BRAND_PALETTE,
    fonts: BRAND_FONTS.map(({ id, label, category }) => ({ id, label, category })),
    cardImageRatios: Object.values(CARD_IMAGE_RATIOS),
    currencies: BRAND_CURRENCIES,
    currencyDisplayModes: ["SYMBOL", "CODE", "SYMBOL_CODE"],
    imageSpecs: {
      logo: { width: LOGO_SPEC.width, height: LOGO_SPEC.height, maxBytes: LOGO_SPEC.maxBytes },
      favicon: {
        width: FAVICON_SPEC.width,
        height: FAVICON_SPEC.height,
        maxBytes: FAVICON_SPEC.maxBytes,
      },
    },
    logoWidth: { min: MIN_LOGO_WIDTH, max: MAX_LOGO_WIDTH },
    receiptFooter: { maxLength: MAX_RECEIPT_FOOTER_LENGTH },
  };
}

/* ── 6. The write ────────────────────────────────────────────────────────── */

/**
 * Apply a branding PATCH.
 *
 * The sequence is deliberate:
 *
 *   1. Load the tier and the existing row (two cheap reads).
 *   2. Apply the tier colour rule — **throws before any upload**, so a SMALL
 *      agency trying a custom colour never costs an S3 PUT.
 *   3. Validate image bytes — again before upload, same reason.
 *   4. Upload both files in parallel.
 *   5. `upsert` the row.
 *   6. Best-effort delete of the files that were just replaced.
 *   7. **Day 4:** queue the static-site regeneration.
 *
 * Note step 6 happens *after* the database commit. If it ran before, a failed
 * upsert would leave a row pointing at a file we had already deleted — a live
 * site with a broken logo, which is far worse than an orphaned object.
 *
 * Step 7 is after the commit for a sharper version of the same reason: every
 * throw above it — the tier 403, the image 400s, a failed upload — leaves this
 * line unreached, so **a rejected save never purges a cache**. A purge on a
 * rejected save is not merely wasted; it forces a rebuild of pages that did not
 * change, and on a busy platform that is a self-inflicted origin stampede
 * triggered by invalid input, which is the shape of a denial-of-service bug.
 */
export async function updateAgencyBranding(
  agencyId: string,
  input: BrandingUpdateInput,
  files: BrandImageFiles = {},
): Promise<ResolvedBranding & { regeneration: RegenerationReceipt }> {
  const agency = await getAgencyBrandContext(agencyId);
  const existing = await db.agencyBranding.findUnique({ where: { agencyId } });

  const logoFile = files.logo?.[0];
  const faviconFile = files.favicon?.[0];

  const hasFieldUpdate = Object.keys(input).length > 0;
  if (!hasFieldUpdate && !logoFile && !faviconFile) {
    throw httpError(400, "No branding fields provided to update");
  }

  // ── Step 2: the tier rule.
  const color = resolveColorForTier(agency.tier, input);

  // ── Step 3: image checks, both before either upload.
  if (logoFile) assertValidBrandImage(logoFile, LOGO_SPEC);
  if (faviconFile) assertValidBrandImage(faviconFile, FAVICON_SPEC);

  // ── Step 4: upload. `Promise.all` over a filtered list so one missing file
  // does not stall the other — the same shape the KYC upload uses.
  const [logoUrl, faviconUrl] = await Promise.all([
    logoFile ? uploadFile(logoFile) : Promise.resolve(undefined),
    faviconFile ? uploadFile(faviconFile) : Promise.resolve(undefined),
  ]);

  /**
   * Build the column patch.
   *
   * Assigned key by key rather than spread from `input`, for two reasons: the
   * colour columns are server-derived and must not be taken from the body, and
   * a spread would happily write an `undefined` for a key the request never
   * sent, which Prisma treats as "no change" today but is a silent trap if the
   * shape ever changes.
   */
  const data: Record<string, unknown> = {};

  if (input.brandName !== undefined) data.brandName = input.brandName;
  if (input.fontFamily !== undefined) data.fontFamily = input.fontFamily;
  if (input.cardImageRatio !== undefined) data.cardImageRatio = input.cardImageRatio;
  if (input.currencyCode !== undefined) data.currencyCode = input.currencyCode;
  if (input.currencyDisplay !== undefined) data.currencyDisplay = input.currencyDisplay;

  // `null` is a meaningful value here — "clear my override" — so the test is
  // against `undefined`, not against falsiness. `if (input.currencySymbol)`
  // would make clearing the override impossible.
  if (input.currencySymbol !== undefined) data.currencySymbol = input.currencySymbol;

  if (input.logoWidth !== undefined) data.logoWidth = input.logoWidth;
  if (input.receiptFooter !== undefined) data.receiptFooter = input.receiptFooter;

  if (color) {
    data.primaryColor = color.primaryColor;
    data.paletteId = color.paletteId;
  }

  if (logoUrl) data.logoUrl = logoUrl;
  if (faviconUrl) data.faviconUrl = faviconUrl;

  // ── Step 5: one write that works whether or not a row exists.
  const saved = await db.agencyBranding.upsert({
    where: { agencyId },
    update: data,
    create: { agencyId, ...data },
  });

  // ── Step 6: clean up what we replaced.
  if (logoUrl) await discardReplacedFile(existing?.logoUrl);
  if (faviconUrl) await discardReplacedFile(existing?.faviconUrl);

  // ── Step 7: publish. Returns immediately; the pipeline runs in the
  // background and updates this receipt object in place.
  const regeneration = queueRegeneration({
    agencyId,
    slug: agency.slug,
    customDomain: agency.customDomain,
    scopes: ["branding"],
    // The saved row's own timestamp, so the version the renderer is told to
    // publish is the version the database actually holds — not "now", which is
    // a slightly later moment and drifts under load.
    version: saved.updatedAt,
  });

  return { ...resolveBranding(agency, saved as BrandingRow), regeneration };
}
