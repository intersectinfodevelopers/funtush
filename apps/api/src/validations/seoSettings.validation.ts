/**
 * ── Request validation for the SEO-settings endpoint (backend catch-up pass) ─
 *
 * Same split every Day 1–3 schema uses: this file answers "is this request
 * well-formed" (shape, length, URL safety); nothing here needs the database.
 */

import { z } from "zod";
import { isSafeLinkUrl } from "../data/siteConfig";
import { SEO_TEXT_LIMITS } from "../data/seoSettings";

/**
 * Text that ends up in `<title>`/`<meta>` attribute content.
 *
 * `<` and `>` are rejected for the same reason `siteConfig.validation.ts`'s
 * `safeText` rejects them there — this is defence in depth, not the defence;
 * the renderer must still escape these strings when writing the tag.
 */
function safeMetaText(field: string, max: number) {
  return z
    .string()
    .trim()
    .max(max, `${field} must be at most ${max} characters`)
    .refine((value) => !/[<>]/.test(value), {
      message: `${field} must not contain < or >`,
    });
}

export const seoSettingsUpdateSchema = z
  .object({
    metaTitle: safeMetaText("Meta title", SEO_TEXT_LIMITS.metaTitle.max).nullable().optional(),
    metaDescription: safeMetaText("Meta description", SEO_TEXT_LIMITS.metaDescription.max)
      .nullable()
      .optional(),
    ogImageUrl: z
      .string()
      .trim()
      .refine(isSafeLinkUrl, { message: "Image URL must be a full http:// or https:// URL" })
      .nullable()
      .optional(),
  })
  /** Reject unknown keys rather than silently dropping them — Day 1's rule. */
  .strict();

export type SeoSettingsUpdateInput = z.infer<typeof seoSettingsUpdateSchema>;
