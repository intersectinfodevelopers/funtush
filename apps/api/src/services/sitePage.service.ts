/**
 * ── Page-builder service (backend catch-up pass, Phase 8) ────────────────────
 *
 * Owns everything behind the "Templates" builder screen and the public read
 * the white-label renderer performs to draw an agency's homepage.
 *
 * The backend counterpart of the frontend prototype's `MySite` model
 * (`src/lib/mock/site-pages.ts`): one editable page per agency, built from an
 * ordered list of sections. Mirrors `navigation.service.ts` deliberately —
 * same one-row-per-agency shape, same "resolve turns nullable-everything rows
 * into something a renderer can use with no `??` of its own" job, same
 * `agencyId`-from-the-session rule (Backend Guide §4).
 *
 * **Two write operations, not one, and that split is the whole design:**
 *
 *   - `updateSitePage` — an ordinary PATCH. Chrome fields (`variant`, `name`,
 *     header/footer) merge like every sibling module's scalars; `sections`,
 *     when sent, is a full replace, exactly Day 3's `items` semantics: the
 *     client's whole job is "here is my page, in its final order," so there
 *     is nothing to reconcile against.
 *   - `applySiteTemplate` — a **separate, deliberately narrow** action that
 *     replaces the section list with a template's starter set. The frontend
 *     prototype itself gates this behind a "Replace your current site?"
 *     confirmation dialog (`TemplatesTab.tsx`) precisely because it is
 *     destructive; folding `templateId` into the general PATCH would let a
 *     client nuke a hand-built page by including one extra field in an
 *     unrelated header-style save.
 *
 * `AgencySitePage` carries **no `published` flag**. Whether the public site
 * is live at all is `Agency.publishedAt`'s job (Phase 6); this module only
 * answers "what renders", never "is it currently shown" — see the schema
 * comment on `AgencySitePage` for the full reasoning.
 */

import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";
import {
  DEFAULT_FOOTER,
  DEFAULT_HEADER,
  DEFAULT_TEMPLATE,
  FOOTER_STYLES,
  HEADER_STYLES,
  HERO_HEIGHTS,
  MARQUEE_DIRECTIONS,
  MAX_SECTIONS,
  MAX_SELECTED_IDS,
  SECTION_BASE_DEFAULTS,
  SECTION_TYPES,
  SITE_TEMPLATES,
  WIDTH_PERCENT_OPTIONS,
  allowsTemplate,
  findTemplate,
  sectionDefaultsFor,
  type SiteTemplateDefinition,
  type SitePageFooterStyleId,
  type SitePageHeaderStyleId,
  type SitePageHeroHeightId,
  type SitePageMarqueeDirectionId,
  type SitePageSectionTypeId,
  type SitePageVariantId,
} from "../data/sitePage";
import type { SitePageUpdateInput } from "../validations/sitePage.validation";
import { getAgencyBrandContext } from "./branding.service";
import { queueRegeneration, type RegenerationReceipt } from "./regeneration.service";

/* ── Types ───────────────────────────────────────────────────────────────── */

/** One row of `agency_site_page_sections`, as Prisma returns it. */
export interface SitePageSectionRow {
  id: string;
  type: SitePageSectionTypeId;
  position: number;
  title: string | null;
  text: string | null;
  subtitle: string | null;
  image: string | null;
  link: string | null;
  ctaText: string | null;
  ctaText2: string | null;
  ctaLink2: string | null;
  heroHeight: SitePageHeroHeightId | null;
  overlayEnabled: boolean;
  fontSize: number | null;
  speed: number | null;
  direction: SitePageMarqueeDirectionId | null;
  useThemeBg: boolean;
  bgColor: string | null;
  useThemeText: boolean;
  textColor: string | null;
  spacingTop: number | null;
  spacingBottom: number | null;
  itemCount: number | null;
  selectedIds: string[];
  cardWidth: number | null;
  cardHeight: number | null;
  adPosition: string | null;
  widthPercent: number;
}

/** The subset of an `agency_site_pages` row (plus its sections) this module reads. */
export interface SitePageRow {
  templateId: string | null;
  variant: SitePageVariantId;
  name: string | null;
  headerStyle: SitePageHeaderStyleId;
  headerCtaText: string | null;
  headerCtaLink: string | null;
  headerSticky: boolean;
  footerStyle: SitePageFooterStyleId;
  sections: SitePageSectionRow[];
  updatedAt: Date;
}

export interface ResolvedHeader {
  style: SitePageHeaderStyleId;
  ctaText: string;
  ctaLink: string;
  sticky: boolean;
}

export interface ResolvedFooter {
  style: SitePageFooterStyleId;
}

/** What the public renderer receives, and what the dashboard read is built on. */
export interface ResolvedSitePage {
  templateId: string | null;
  variant: SitePageVariantId;
  name: string | null;
  header: ResolvedHeader;
  footer: ResolvedFooter;
  sections: SitePageSectionRow[];
  updatedAt: Date | null;
}

/** What the dashboard settings screen receives: the resolved page plus capabilities. */
export interface EditableSitePage extends ResolvedSitePage {
  tier: string;
  capabilities: {
    paidTemplates: boolean;
  };
}

/* ── 1. Tier rules ───────────────────────────────────────────────────────── */

/**
 * Refuse a template switch the tier is not entitled to.
 *
 * 403, not 400: this is a well-formed request for a template that exists,
 * which this tier simply may not use yet — the same distinction every prior
 * module in this pass draws between "malformed" and "not allowed".
 */
function assertTemplateAllowed(tier: string, template: SiteTemplateDefinition): void {
  if (allowsTemplate(tier, template)) return;

  throw httpError(403, `The "${template.name}" template is available on paid plans. Upgrade to use it.`);
}

/* ── 2. Section defaults ─────────────────────────────────────────────────── */

/**
 * A fresh section's full row shape (minus `id`/`position`, which the caller
 * assigns), combining the universal base defaults with the type's own seed
 * values. The one place both `applySiteTemplate`'s real database rows and
 * `resolveSitePage`'s virtual "never configured" rows get their values from,
 * so the two can never quietly drift apart.
 */
function sectionDefaultRow(type: SitePageSectionTypeId): Omit<SitePageSectionRow, "id" | "position"> {
  const seed = sectionDefaultsFor(type);

  return {
    type,
    title: seed.title ?? null,
    text: seed.text ?? null,
    subtitle: seed.subtitle ?? null,
    image: null,
    link: null,
    ctaText: seed.ctaText ?? null,
    ctaText2: null,
    ctaLink2: null,
    heroHeight: seed.heroHeight ?? null,
    overlayEnabled: SECTION_BASE_DEFAULTS.overlayEnabled,
    fontSize: null,
    speed: seed.speed ?? null,
    direction: seed.direction ?? null,
    useThemeBg: SECTION_BASE_DEFAULTS.useThemeBg,
    bgColor: null,
    useThemeText: SECTION_BASE_DEFAULTS.useThemeText,
    textColor: null,
    spacingTop: null,
    spacingBottom: null,
    itemCount: seed.itemCount ?? null,
    selectedIds: [],
    cardWidth: null,
    cardHeight: null,
    adPosition: null,
    widthPercent: SECTION_BASE_DEFAULTS.widthPercent,
  };
}

/** A template's starter sections, with placeholder ids — used only when no
 * row has ever been saved, so there is nothing in the database to give the
 * sections real ids yet. */
function buildStarterSections(template: SiteTemplateDefinition): SitePageSectionRow[] {
  return template.sections.map((type, index) => ({
    id: `starter-${index}`,
    position: index,
    ...sectionDefaultRow(type),
  }));
}

/* ── 3. Resolution — row → what renders ──────────────────────────────────── */

/**
 * Turn a (possibly missing) row into exactly what the renderer should draw.
 *
 * No row ⇒ the agency has never opened the builder, which resolves to the
 * platform's default starter template — the same "no row ⇒ platform default"
 * rule every White-label-week module uses, extended here to a whole page
 * instead of a handful of scalars.
 */
export function resolveSitePage(row: SitePageRow | null): ResolvedSitePage {
  if (!row) {
    return {
      templateId: null,
      variant: DEFAULT_TEMPLATE.variant,
      name: null,
      header: { ...DEFAULT_HEADER },
      footer: { ...DEFAULT_FOOTER },
      sections: buildStarterSections(DEFAULT_TEMPLATE),
      updatedAt: null,
    };
  }

  return {
    templateId: row.templateId,
    variant: row.variant,
    name: row.name,
    header: {
      style: row.headerStyle,
      ctaText: row.headerCtaText?.trim() || DEFAULT_HEADER.ctaText,
      ctaLink: row.headerCtaLink?.trim() || DEFAULT_HEADER.ctaLink,
      sticky: row.headerSticky,
    },
    footer: { style: row.footerStyle },
    sections: row.sections.slice().sort((a, b) => a.position - b.position),
    updatedAt: row.updatedAt,
  };
}

/* ── 4. Reads ────────────────────────────────────────────────────────────── */

async function loadSitePageRow(agencyId: string): Promise<SitePageRow | null> {
  const row = await db.agencySitePage.findUnique({
    where: { agencyId },
    include: { sections: { orderBy: { position: "asc" } } },
  });

  if (!row) return null;

  return {
    templateId: row.templateId,
    variant: row.variant as SitePageVariantId,
    name: row.name,
    headerStyle: row.headerStyle as SitePageHeaderStyleId,
    headerCtaText: row.headerCtaText,
    headerCtaLink: row.headerCtaLink,
    headerSticky: row.headerSticky,
    footerStyle: row.footerStyle as SitePageFooterStyleId,
    sections: row.sections as SitePageSectionRow[],
    updatedAt: row.updatedAt,
  };
}

/** The dashboard read. */
export async function getSitePage(agencyId: string): Promise<EditableSitePage> {
  const agency = await getAgencyBrandContext(agencyId);
  const row = await loadSitePageRow(agencyId);

  return {
    ...resolveSitePage(row),
    tier: agency.tier,
    capabilities: {
      paidTemplates: agency.tier !== "FREE",
    },
  };
}

/** Everything the settings screen needs to draw the builder's chrome. */
export async function getSitePageOptions(agencyId: string) {
  const agency = await getAgencyBrandContext(agencyId);

  return {
    tier: agency.tier,
    templates: SITE_TEMPLATES.map((template) => ({
      ...template,
      locked: !allowsTemplate(agency.tier, template),
    })),
    sectionTypes: SECTION_TYPES,
    headerStyles: HEADER_STYLES,
    footerStyles: FOOTER_STYLES,
    heroHeights: HERO_HEIGHTS,
    directions: MARQUEE_DIRECTIONS,
    widthPercentOptions: WIDTH_PERCENT_OPTIONS,
    limits: {
      maxSections: MAX_SECTIONS,
      maxSelectedIds: MAX_SELECTED_IDS,
    },
    capabilities: {
      paidTemplates: agency.tier !== "FREE",
    },
  };
}

/**
 * The public read — what the white-label renderer calls to draw the
 * homepage.
 *
 * A `SUSPENDED` or `LOCKED` agency gets a **404**, matching every sibling
 * public read in this pass. Unlike Branding/SiteConfig/Navigation, this read
 * *is* mounted behind `requireSiteLive` at the route layer — see
 * `routes/sitePage.routes.ts` — because sections are the page's actual
 * content, not chrome a visitor needs even on a coming-soon page.
 */
export async function getPublicSitePageBySlug(
  slug: string,
): Promise<ResolvedSitePage & { agencySlug: string }> {
  const agency = await db.agency.findUnique({
    where: { slug },
    select: {
      slug: true,
      status: true,
      sitePage: {
        include: { sections: { orderBy: { position: "asc" } } },
      },
    },
  });

  if (!agency) throw httpError(404, "Site not found");
  if (agency.status === "SUSPENDED" || agency.status === "LOCKED") {
    throw httpError(404, "Site not found");
  }

  const row: SitePageRow | null = agency.sitePage
    ? {
        templateId: agency.sitePage.templateId,
        variant: agency.sitePage.variant as SitePageVariantId,
        name: agency.sitePage.name,
        headerStyle: agency.sitePage.headerStyle as SitePageHeaderStyleId,
        headerCtaText: agency.sitePage.headerCtaText,
        headerCtaLink: agency.sitePage.headerCtaLink,
        headerSticky: agency.sitePage.headerSticky,
        footerStyle: agency.sitePage.footerStyle as SitePageFooterStyleId,
        sections: agency.sitePage.sections as SitePageSectionRow[],
        updatedAt: agency.sitePage.updatedAt,
      }
    : null;

  return { ...resolveSitePage(row), agencySlug: agency.slug };
}

/* ── 5. The writes ───────────────────────────────────────────────────────── */

/**
 * Apply a page PATCH.
 *
 * See the file header for why `sections`, when sent, is a full replace
 * rather than a merge — identical reasoning and identical mechanics to
 * `navigation.service.ts`'s `updateNavigation`: delete every stored section,
 * recreate the new list from scratch, `position` renumbered from the array's
 * index. Bounded by `MAX_SECTIONS` (40), so "delete a few dozen rows, insert
 * a few dozen rows" stays cheap enough that diffing against stored ids would
 * be solving a performance problem this endpoint does not have.
 */
export async function updateSitePage(
  agencyId: string,
  input: SitePageUpdateInput,
): Promise<EditableSitePage & { regeneration: RegenerationReceipt }> {
  const agency = await getAgencyBrandContext(agencyId);

  if (Object.keys(input).length === 0) {
    throw httpError(400, "No page fields provided to update");
  }

  const settingsData: Record<string, unknown> = {};
  if (input.variant !== undefined) settingsData.variant = input.variant;
  if (input.name !== undefined) settingsData.name = input.name;
  if (input.headerStyle !== undefined) settingsData.headerStyle = input.headerStyle;
  if (input.headerCtaText !== undefined) settingsData.headerCtaText = input.headerCtaText;
  if (input.headerCtaLink !== undefined) settingsData.headerCtaLink = input.headerCtaLink;
  if (input.headerSticky !== undefined) settingsData.headerSticky = input.headerSticky;
  if (input.footerStyle !== undefined) settingsData.footerStyle = input.footerStyle;

  await db.$transaction(async (tx) => {
    const site = await tx.agencySitePage.upsert({
      where: { agencyId },
      update: settingsData,
      create: { agencyId, ...settingsData },
    });

    if (input.sections === undefined) return;

    await tx.agencySitePageSection.deleteMany({ where: { siteId: site.id } });

    for (const [index, section] of input.sections.entries()) {
      await tx.agencySitePageSection.create({
        data: {
          siteId: site.id,
          type: section.type as SitePageSectionTypeId,
          position: index,
          title: section.title ?? null,
          text: section.text ?? null,
          subtitle: section.subtitle ?? null,
          image: section.image ?? null,
          link: section.link ?? null,
          ctaText: section.ctaText ?? null,
          ctaText2: section.ctaText2 ?? null,
          ctaLink2: section.ctaLink2 ?? null,
          heroHeight: (section.heroHeight ?? null) as SitePageHeroHeightId | null,
          overlayEnabled: section.overlayEnabled ?? SECTION_BASE_DEFAULTS.overlayEnabled,
          fontSize: section.fontSize ?? null,
          speed: section.speed ?? null,
          direction: (section.direction ?? null) as SitePageMarqueeDirectionId | null,
          useThemeBg: section.useThemeBg ?? SECTION_BASE_DEFAULTS.useThemeBg,
          bgColor: section.bgColor ?? null,
          useThemeText: section.useThemeText ?? SECTION_BASE_DEFAULTS.useThemeText,
          textColor: section.textColor ?? null,
          spacingTop: section.spacingTop ?? null,
          spacingBottom: section.spacingBottom ?? null,
          itemCount: section.itemCount ?? null,
          selectedIds: section.selectedIds ?? [],
          cardWidth: section.cardWidth ?? null,
          cardHeight: section.cardHeight ?? null,
          adPosition: section.adPosition ?? null,
          widthPercent: section.widthPercent ?? SECTION_BASE_DEFAULTS.widthPercent,
        },
      });
    }
  });

  const sitePage = await getSitePage(agencyId);

  const regeneration = queueRegeneration({
    agencyId,
    slug: agency.slug,
    customDomain: agency.customDomain,
    scopes: ["sitePage"],
    version: sitePage.updatedAt,
  });

  return { ...sitePage, regeneration };
}

/**
 * `POST /agencies/me/site-page/apply-template` — start over from a template.
 *
 * Replaces the entire section list with the template's starter set, the same
 * destructive "Switch template" action the frontend prototype's
 * `siteFromTemplate()` performs, gated by tier first. `templateId` and
 * `variant` are the only settings-row fields this touches — an agency's
 * header/footer chrome and site name survive a template switch, matching the
 * frontend's own behaviour (`TemplatesTab.tsx` replaces `sections` only).
 */
export async function applySiteTemplate(
  agencyId: string,
  templateId: string,
): Promise<EditableSitePage & { regeneration: RegenerationReceipt }> {
  const agency = await getAgencyBrandContext(agencyId);

  const template = findTemplate(templateId);
  if (!template) throw httpError(404, "Unknown template");
  assertTemplateAllowed(agency.tier, template);

  await db.$transaction(async (tx) => {
    const site = await tx.agencySitePage.upsert({
      where: { agencyId },
      update: { templateId: template.id, variant: template.variant },
      create: { agencyId, templateId: template.id, variant: template.variant },
    });

    await tx.agencySitePageSection.deleteMany({ where: { siteId: site.id } });

    for (const [index, type] of template.sections.entries()) {
      await tx.agencySitePageSection.create({
        data: { siteId: site.id, position: index, ...sectionDefaultRow(type) },
      });
    }
  });

  const sitePage = await getSitePage(agencyId);

  const regeneration = queueRegeneration({
    agencyId,
    slug: agency.slug,
    customDomain: agency.customDomain,
    scopes: ["sitePage"],
    version: sitePage.updatedAt,
  });

  return { ...sitePage, regeneration };
}
