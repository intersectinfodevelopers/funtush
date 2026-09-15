/**
 * ── Request validation for the social-links endpoint (backend catch-up pass) ─
 *
 * Same split every Day 1–3 schema uses: this file answers "is this request
 * well-formed", `socialLinks.service.ts` answers "does the merged result make
 * sense" — though there's little of the latter here, since no field in this
 * module depends on another the way `siteConfig`'s top-bar text/enabled pair
 * does.
 */

import { z } from "zod";
import { isSafeLinkUrl } from "../data/siteConfig";
import { MAX_SOCIAL_FIELD_LENGTH, isPlausibleWhatsAppNumber } from "../data/socialLinks";

/**
 * A social profile URL. Reuses `isSafeLinkUrl` (Day 2's `http:`/`https:`
 * whitelist) rather than re-deriving URL safety — see `data/siteConfig.ts`
 * for why a hand-rolled scheme check is the wrong tool here.
 *
 * `.nullable()` is how an agency clears a link it previously set; an absent
 * key leaves it untouched — the same PATCH semantics every settings screen
 * in this codebase uses.
 */
const socialUrl = z
  .string()
  .trim()
  .max(MAX_SOCIAL_FIELD_LENGTH, `Link must be at most ${MAX_SOCIAL_FIELD_LENGTH} characters`)
  .refine(isSafeLinkUrl, { message: "Link must be a full http:// or https:// URL" });

export const socialLinksUpdateSchema = z
  .object({
    facebookUrl: socialUrl.nullable().optional(),
    instagramUrl: socialUrl.nullable().optional(),
    tiktokUrl: socialUrl.nullable().optional(),

    /** A phone number, not a URL — the renderer builds the `wa.me/` link. */
    whatsappNumber: z
      .string()
      .trim()
      .max(MAX_SOCIAL_FIELD_LENGTH)
      .refine(isPlausibleWhatsAppNumber, {
        message: "WhatsApp number must be digits only (7-15 of them), optionally starting with +",
      })
      .nullable()
      .optional(),

    youtubeUrl: socialUrl.nullable().optional(),
  })
  /** Reject unknown keys rather than silently dropping them — Day 1's rule. */
  .strict();

export type SocialLinksUpdateInput = z.infer<typeof socialLinksUpdateSchema>;
