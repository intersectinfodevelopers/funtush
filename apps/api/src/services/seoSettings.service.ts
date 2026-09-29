/**
 * ── SEO-settings service (backend catch-up pass) ──────────────────────────────
 *
 * Owns `PATCH /agencies/me/seo` and the public read the white-label renderer
 * performs to build a page's `<title>`/`<meta>` tags.
 *
 * Same shape as `socialLinks.service.ts`, and the same two things are
 * deliberately absent: no tier rules (every agency gets a title and
 * description — see `data/seoSettings.ts`), and no cross-field coherence
 * rules (the three fields are independent). What survives from Day 1/2: a
 * PATCH merges onto the row (`undefined` ⇒ untouched, `null` ⇒ cleared), one
 * `upsert`, and the write queues a regeneration.
 */

import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";
import { DEFAULT_SEO_SETTINGS } from "../data/seoSettings";
import type { SeoSettingsUpdateInput } from "../validations/seoSettings.validation";
import { getAgencyBrandContext } from "./branding.service";
import { queueRegeneration, type RegenerationReceipt } from "./regeneration.service";

/** The subset of an `agency_seo_settings` row this module reads. */
export interface SeoSettingsRow {
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  updatedAt: Date;
}

export interface SeoSettingsValues {
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
}

export interface EditableSeoSettings {
  values: SeoSettingsValues;
  updatedAt: Date | null;
}

/**
 * The public shape. `metaTitle`/`metaDescription` fall back to the agency's
 * own name/tagline-free defaults **at the render layer, not here** — this
 * service returns exactly what is stored (possibly `null`), the same way
 * `getSiteConfig` returns raw values rather than resolved ones, so a settings
 * form shows what is actually saved instead of a filled-in default that
 * looks saved and is not.
 */
export type ResolvedSeoSettings = SeoSettingsValues & { updatedAt: Date | null };

/** The stored row with all defaults applied — the state before a patch. */
export function withDefaults(row: SeoSettingsRow | null): SeoSettingsValues {
  return {
    metaTitle: row?.metaTitle ?? DEFAULT_SEO_SETTINGS.metaTitle,
    metaDescription: row?.metaDescription ?? DEFAULT_SEO_SETTINGS.metaDescription,
    ogImageUrl: row?.ogImageUrl ?? DEFAULT_SEO_SETTINGS.ogImageUrl,
  };
}

/** The dashboard read. */
export async function getSeoSettings(agencyId: string): Promise<EditableSeoSettings> {
  const row = (await db.agencySeoSettings.findUnique({ where: { agencyId } })) as SeoSettingsRow | null;

  return {
    values: withDefaults(row),
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * The public read. A `SUSPENDED` or `LOCKED` agency gets a 404, matching
 * every other Day 1–3 public read.
 */
export async function getPublicSeoSettingsBySlug(slug: string): Promise<ResolvedSeoSettings> {
  const agency = await db.agency.findUnique({
    where: { slug },
    select: { status: true, seoSettings: true },
  });

  if (!agency) throw httpError(404, "Site not found");
  if (agency.status === "SUSPENDED" || agency.status === "LOCKED") {
    throw httpError(404, "Site not found");
  }

  const row = agency.seoSettings as SeoSettingsRow | null;

  return { ...withDefaults(row), updatedAt: row?.updatedAt ?? null };
}

/** Apply an SEO-settings PATCH. */
export async function updateSeoSettings(
  agencyId: string,
  input: SeoSettingsUpdateInput,
): Promise<EditableSeoSettings & { regeneration: RegenerationReceipt }> {
  const agency = await getAgencyBrandContext(agencyId);

  if (Object.keys(input).length === 0) {
    throw httpError(400, "No SEO fields provided to update");
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) data[key] = value;
  }

  await db.agencySeoSettings.upsert({
    where: { agencyId },
    update: data,
    create: { agencyId, ...data },
  });

  // Re-read through `getSeoSettings` so the response comes from the same code
  // path as a plain GET.
  const settings = await getSeoSettings(agencyId);

  const regeneration = queueRegeneration({
    agencyId,
    slug: agency.slug,
    customDomain: agency.customDomain,
    scopes: ["seoSettings"],
    version: settings.updatedAt,
  });

  return { ...settings, regeneration };
}
