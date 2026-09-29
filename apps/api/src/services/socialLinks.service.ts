/**
 * ── Social-links service (backend catch-up pass) ──────────────────────────────
 *
 * Owns `PATCH /agencies/me/social-links` and the public read the white-label
 * renderer performs on every page view (the footer/header social icons).
 *
 * Simpler than `branding.service.ts` and `siteConfig.service.ts` in two ways
 * that are worth naming, because their absence is a choice and not an
 * oversight:
 *
 *   - **No tier rules.** Every agency gets to say who it is on social media —
 *     see `data/socialLinks.ts` for the reasoning.
 *   - **No cross-field coherence rules.** Nothing here depends on anything
 *     else the way `siteConfig`'s "an enabled top bar needs text" does; each
 *     of the five links is independent, so there is nothing to check beyond
 *     what the zod schema already checked.
 *
 * What survives from the Day 1/2 shape: `agencyId` always comes from the
 * session (Backend Guide §4), a PATCH merges onto the existing row rather
 * than replacing it (`undefined` ⇒ untouched, `null` ⇒ cleared — the same
 * distinction Day 2's file header explains), one `upsert`, and the write
 * queues a regeneration so the public site catches up within seconds.
 */

import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";
import { DEFAULT_SOCIAL_LINKS, type SocialLinksField } from "../data/socialLinks";
import type { SocialLinksUpdateInput } from "../validations/socialLinks.validation";
import { getAgencyBrandContext } from "./branding.service";
import { queueRegeneration, type RegenerationReceipt } from "./regeneration.service";

/** The subset of an `agency_social_links` row this module reads. */
export interface SocialLinksRow {
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  whatsappNumber: string | null;
  youtubeUrl: string | null;
  updatedAt: Date;
}

/** Every field with defaults applied — what the dashboard form binds to. */
export type SocialLinksValues = Record<SocialLinksField, string | null>;

export interface EditableSocialLinks {
  values: SocialLinksValues;
  updatedAt: Date | null;
}

/** The public shape: the same values, plus a ready-to-use WhatsApp chat link. */
export interface ResolvedSocialLinks extends SocialLinksValues {
  /** `https://wa.me/<digits>`, or `null` when no number is set. */
  whatsappLink: string | null;
  updatedAt: Date | null;
}

/** The stored row with all defaults applied — the state before a patch. */
export function withDefaults(row: SocialLinksRow | null): SocialLinksValues {
  return {
    facebookUrl: row?.facebookUrl ?? DEFAULT_SOCIAL_LINKS.facebookUrl,
    instagramUrl: row?.instagramUrl ?? DEFAULT_SOCIAL_LINKS.instagramUrl,
    tiktokUrl: row?.tiktokUrl ?? DEFAULT_SOCIAL_LINKS.tiktokUrl,
    whatsappNumber: row?.whatsappNumber ?? DEFAULT_SOCIAL_LINKS.whatsappNumber,
    youtubeUrl: row?.youtubeUrl ?? DEFAULT_SOCIAL_LINKS.youtubeUrl,
  };
}

/** Build the `wa.me/` link from a stored number, stripping everything but digits. */
export function resolveWhatsAppLink(number: string | null): string | null {
  if (!number) return null;
  const digits = number.replace(/[^0-9]/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

/** The dashboard read. */
export async function getSocialLinks(agencyId: string): Promise<EditableSocialLinks> {
  const row = (await db.agencySocialLinks.findUnique({ where: { agencyId } })) as SocialLinksRow | null;

  return {
    values: withDefaults(row),
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * The public read — what the white-label renderer calls on every page view.
 *
 * A `SUSPENDED` or `LOCKED` agency gets a 404, matching Day 1/2 exactly — an
 * inactive agency's socials are its own business, not the platform's to
 * advertise.
 */
export async function getPublicSocialLinksBySlug(slug: string): Promise<ResolvedSocialLinks> {
  const agency = await db.agency.findUnique({
    where: { slug },
    select: { status: true, socialLinks: true },
  });

  if (!agency) throw httpError(404, "Site not found");
  if (agency.status === "SUSPENDED" || agency.status === "LOCKED") {
    throw httpError(404, "Site not found");
  }

  const row = agency.socialLinks as SocialLinksRow | null;
  const values = withDefaults(row);

  return {
    ...values,
    whatsappLink: resolveWhatsAppLink(values.whatsappNumber),
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * Apply a social-links PATCH.
 *
 * `Object.assign`-style spreading would copy `undefined` values and clobber
 * unset fields — see `siteConfig.service.ts`'s `mergePatch` for the full
 * argument. The explicit loop here is the same fix in miniature: no merged
 * state to check coherence against, just a column patch built key by key.
 */
export async function updateSocialLinks(
  agencyId: string,
  input: SocialLinksUpdateInput,
): Promise<EditableSocialLinks & { regeneration: RegenerationReceipt }> {
  const agency = await getAgencyBrandContext(agencyId);

  if (Object.keys(input).length === 0) {
    throw httpError(400, "No social link fields provided to update");
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) data[key] = value;
  }

  await db.agencySocialLinks.upsert({
    where: { agencyId },
    update: data,
    create: { agencyId, ...data },
  });

  // Re-read through `getSocialLinks` so the response is produced by exactly
  // the same code path as a plain GET — see `siteConfig.service.ts` for why
  // two builders for one response shape is a bug waiting to happen.
  const links = await getSocialLinks(agencyId);

  const regeneration = queueRegeneration({
    agencyId,
    slug: agency.slug,
    customDomain: agency.customDomain,
    scopes: ["socialLinks"],
    version: links.updatedAt,
  });

  return { ...links, regeneration };
}
