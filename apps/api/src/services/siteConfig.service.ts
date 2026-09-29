/**
 * ── Site configuration service (White-label week · Day 2) ────────────────────
 *
 * Owns the four switches behind `PATCH /agencies/me/site-config` and the public
 * read the white-label renderer performs on every page view:
 *
 *   1. **Under construction** — serve a coming-soon page to visitors while the
 *      dashboard keeps working.
 *   2. **Top bar** — a static or scrolling announcement on every page.
 *   3. **Popup modal** — Medium and Large only, disabled by default.
 *   4. **"Powered by Funtush" badge** — forced on for the trial, hidden on paid.
 *
 * The file mirrors `branding.service.ts` deliberately, because a reader who has
 * understood Day 1 should not have to learn a second set of habits: the tier
 * rules run before anything is written, resolution turns a row full of nullable
 * columns into something the renderer can use without a single `??`, and every
 * function is keyed by an `agencyId` that came from the session (Backend Guide
 * §4) — never from the request body.
 *
 * ── The one genuinely new idea: the *merged state* ──
 *
 * This is a PATCH endpoint whose fields depend on each other. "Enable the top
 * bar" is only legal if there is text in the bar, and the text might be in the
 * request, or already in the row, or in neither. So every cross-field rule here
 * is checked against `existing row + this patch`, computed once by
 * `mergePatch()`, and never against the request alone. Checking the request
 * alone would reject `{"topBarEnabled": true}` from an agency that wrote its
 * announcement last week — a bug that looks like the API is broken.
 */

import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";
import { allowsFreeColorPicker, findSwatchByHex } from "../data/brandTheme";
import {
  DEFAULT_CONSTRUCTION_COPY,
  DEFAULT_SITE_CONFIG,
  POPUP_FREQUENCIES,
  POPUP_TRIGGERS,
  TOP_BAR_BEHAVIORS,
  allowsPopupModal,
  canToggleFuntushBadge,
  isTrialTier,
  resolveFuntushBadge,
  type PopupFrequencyId,
  type PopupTriggerId,
  type TopBarBehaviorId,
} from "../data/siteConfig";
import {
  POPUP_FIELDS,
  type SiteConfigUpdateInput,
} from "../validations/siteConfig.validation";
import {
  getAgencyBrandContext,
  readableTextColor,
  resolveBranding,
  type BrandingRow,
} from "./branding.service";
import { queueRegeneration, type RegenerationReceipt } from "./regeneration.service";

/* ── Types ───────────────────────────────────────────────────────────────── */

/** The subset of an `agency_site_config` row this module reads. */
export interface SiteConfigRow {
  underConstruction: boolean;
  constructionHeadline: string | null;
  constructionMessage: string | null;
  topBarEnabled: boolean;
  topBarText: string | null;
  topBarBehavior: string;
  topBarBackgroundColor: string | null;
  topBarLinkUrl: string | null;
  topBarDismissible: boolean;
  popupEnabled: boolean;
  popupTitle: string | null;
  popupBody: string | null;
  popupCtaLabel: string | null;
  popupCtaUrl: string | null;
  popupTrigger: string;
  popupDelaySeconds: number;
  popupFrequency: string;
  showFuntushBadge: boolean;
  updatedAt: Date;
}

/** The coming-soon page, ready to render. */
export interface ComingSoonPage {
  headline: string;
  message: string;
}

/** The announcement bar, ready to render. `null` when nothing should show. */
export interface ResolvedTopBar {
  text: string;
  behavior: TopBarBehaviorId;
  /** Always a concrete `#RRGGBB` — the brand colour when nothing was chosen. */
  backgroundColor: string;
  /** Computed from `backgroundColor`, never stored. See `resolveTopBar`. */
  textColor: string;
  linkUrl: string | null;
  dismissible: boolean;
}

/** The promotional modal, ready to render. `null` when nothing should show. */
export interface ResolvedPopup {
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  trigger: PopupTriggerId;
  delaySeconds: number;
  frequency: PopupFrequencyId;
}

/**
 * What the public renderer receives.
 *
 * Note the shape: `topBar` and `popup` are **whole objects or `null`**, not
 * flat fields plus an `enabled` boolean. That is the difference between the
 * renderer writing `if (config.topBar)` and the renderer writing
 * `if (config.topBarEnabled && config.topBarText && !config.underConstruction &&
 * tierAllows(...))`. Every condition the front-end is required to remember is a
 * condition some front-end will forget, and this one would forget it in the
 * direction of showing a marketing popup on a coming-soon page.
 *
 * All the deciding happens here, once, on the server.
 */
export interface ResolvedSiteConfig {
  underConstruction: boolean;
  /** `Agency.publishedAt !== null` — see `resolveSiteConfig`'s doc comment for
   * why this is kept separate from `underConstruction` rather than merged. */
  published: boolean;
  comingSoon: ComingSoonPage | null;
  topBar: ResolvedTopBar | null;
  popup: ResolvedPopup | null;
  showFuntushBadge: boolean;
  updatedAt: Date | null;
}

/** What the dashboard settings screen receives: raw values plus capabilities. */
export interface EditableSiteConfig {
  tier: string;
  /** Stored values, defaults filled in — what the form's inputs bind to. */
  values: {
    underConstruction: boolean;
    constructionHeadline: string | null;
    constructionMessage: string | null;
    topBarEnabled: boolean;
    topBarText: string | null;
    topBarBehavior: TopBarBehaviorId;
    topBarBackgroundColor: string | null;
    topBarLinkUrl: string | null;
    topBarDismissible: boolean;
    popupEnabled: boolean;
    popupTitle: string | null;
    popupBody: string | null;
    popupCtaLabel: string | null;
    popupCtaUrl: string | null;
    popupTrigger: PopupTriggerId;
    popupDelaySeconds: number;
    popupFrequency: PopupFrequencyId;
    showFuntushBadge: boolean;
  };
  /** What this tier may do — so the UI can disable controls instead of failing. */
  capabilities: {
    popupModal: boolean;
    funtushBadgeToggle: boolean;
    /** `"free"` or `"curated"`, matching Day 1's colour rule. */
    topBarColorMode: "free" | "curated";
  };
  /** The effective badge value, tier rule already applied. */
  effectiveFuntushBadge: boolean;
  updatedAt: Date | null;
}

/* ── 1. Merging a patch onto a row ───────────────────────────────────────── */

/**
 * Every field of the config, with defaults filled in and no `undefined`.
 *
 * A distinct type from `SiteConfigRow` because a row's `updatedAt` and `id` are
 * not settings, and because this shape is what the cross-field rules reason
 * about.
 */
export type MergedSiteConfig = Omit<SiteConfigRow, "updatedAt" | "topBarBehavior" | "popupTrigger" | "popupFrequency"> & {
  topBarBehavior: TopBarBehaviorId;
  popupTrigger: PopupTriggerId;
  popupFrequency: PopupFrequencyId;
};

/** The stored config with all defaults applied — the state before a patch. */
export function withDefaults(row: SiteConfigRow | null): MergedSiteConfig {
  return {
    underConstruction: row?.underConstruction ?? DEFAULT_SITE_CONFIG.underConstruction,
    constructionHeadline: row?.constructionHeadline ?? null,
    constructionMessage: row?.constructionMessage ?? null,
    topBarEnabled: row?.topBarEnabled ?? DEFAULT_SITE_CONFIG.topBarEnabled,
    topBarText: row?.topBarText ?? null,
    topBarBehavior: (row?.topBarBehavior ?? DEFAULT_SITE_CONFIG.topBarBehavior) as TopBarBehaviorId,
    topBarBackgroundColor: row?.topBarBackgroundColor ?? null,
    topBarLinkUrl: row?.topBarLinkUrl ?? null,
    topBarDismissible: row?.topBarDismissible ?? DEFAULT_SITE_CONFIG.topBarDismissible,
    popupEnabled: row?.popupEnabled ?? DEFAULT_SITE_CONFIG.popupEnabled,
    popupTitle: row?.popupTitle ?? null,
    popupBody: row?.popupBody ?? null,
    popupCtaLabel: row?.popupCtaLabel ?? null,
    popupCtaUrl: row?.popupCtaUrl ?? null,
    popupTrigger: (row?.popupTrigger ?? DEFAULT_SITE_CONFIG.popupTrigger) as PopupTriggerId,
    popupDelaySeconds: row?.popupDelaySeconds ?? DEFAULT_SITE_CONFIG.popupDelaySeconds,
    popupFrequency: (row?.popupFrequency ?? DEFAULT_SITE_CONFIG.popupFrequency) as PopupFrequencyId,
    showFuntushBadge: row?.showFuntushBadge ?? DEFAULT_SITE_CONFIG.showFuntushBadge,
  };
}

/**
 * Apply a patch to a row and return what the config *would* be if it saved.
 *
 * The whole function is one rule: **a key the request did not send must not
 * change anything.** In JSON that distinction is `undefined` (absent) versus
 * `null` (explicitly cleared), and the two must not be confused — `null` on
 * `topBarText` means "delete my announcement", absent means "I was only changing
 * the colour, leave the text".
 *
 * `Object.assign(base, input)` would break exactly that: it copies keys whose
 * value is `undefined`, overwriting a real stored string with nothing. Hence the
 * explicit loop with the `!== undefined` test — the same guard Day 1 used on
 * `currencySymbol`, generalised to nineteen fields.
 */
export function mergePatch(
  row: SiteConfigRow | null,
  input: SiteConfigUpdateInput,
): MergedSiteConfig {
  const merged = withDefaults(row) as MergedSiteConfig & Record<string, unknown>;

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) merged[key] = value;
  }

  return merged;
}

/* ── 2. Tier rules ───────────────────────────────────────────────────────── */

/** `true` when the request mentions any popup field at all. */
export function touchesPopup(input: SiteConfigUpdateInput): boolean {
  return POPUP_FIELDS.some((field) => input[field] !== undefined);
}

/**
 * Refuse popup edits from a tier that does not have the popup.
 *
 * **403, not 400** — Day 1's rule, and it holds for the same reason. 400 means
 * "you sent something malformed", which invites the agency to try a different
 * spelling. 403 means "this is well-formed and you may not do it", which is the
 * truth and points at the upgrade page.
 *
 * The check is "did the request *mention* the popup", not "did it try to enable
 * the popup". A Small-tier agency quietly PATCHing `popupTitle` is writing copy
 * for a modal it cannot show; letting that succeed with a 200 teaches it the
 * feature works, and the bug report arrives later and angrier.
 */
export function assertPopupAllowed(tier: string, input: SiteConfigUpdateInput): void {
  if (!touchesPopup(input)) return;
  if (allowsPopupModal(tier)) return;

  throw httpError(
    403,
    "Popup modals are available on the Medium and Large plans. Upgrade to configure one.",
  );
}

/**
 * Refuse an attempt to hide the badge from a tier that must show it.
 *
 * Note what is *not* refused: sending `showFuntushBadge: true` on the trial. It
 * agrees with the forced value, so there is nothing to refuse — rejecting a
 * request that asks for the state the system is already in is pedantry that
 * breaks "save the whole form" clients, which send every field every time.
 */
export function assertBadgeChangeAllowed(tier: string, input: SiteConfigUpdateInput): void {
  if (input.showFuntushBadge === undefined) return;
  if (canToggleFuntushBadge(tier)) return;
  if (input.showFuntushBadge === true) return;

  throw httpError(
    403,
    "The \"Powered by Funtush\" badge is part of the free trial and cannot be hidden. " +
      "Upgrade to a paid plan to remove it.",
  );
}

/**
 * Apply Day 1's colour rule to the top bar background.
 *
 * Reusing the *policy* (`allowsFreeColorPicker`) rather than re-deciding it is
 * the point. If the platform later lets Small type free hex codes, that has to
 * become true for the top bar on the same day; two copies of the rule guarantee
 * it does not.
 *
 * Returns nothing — it throws or it does not. `null` (clear the override) and an
 * absent key are both fine for every tier: going *back* to the brand colour is
 * never a paid feature.
 */
export function assertTopBarColorAllowed(tier: string, input: SiteConfigUpdateInput): void {
  const hex = input.topBarBackgroundColor;
  if (!hex) return;
  if (allowsFreeColorPicker(tier)) return;
  if (findSwatchByHex(hex)) return;

  throw httpError(
    403,
    "Your plan includes the curated colour palette. Choose one of the provided colours for the " +
      "top bar, or leave it unset to match your brand colour.",
  );
}

/* ── 3. Cross-field rules, checked against the merged state ──────────────── */

/**
 * Reject configurations that would render as something broken.
 *
 * Three rules, each of which exists because the alternative is visible on a
 * customer's live website:
 *
 *   1. **An enabled top bar needs text.** Otherwise the site grows a coloured
 *      stripe with nothing in it, and the agency cannot tell whether the feature
 *      is broken or its text was lost.
 *   2. **An enabled popup needs a title and a body.** An empty modal over the
 *      homepage is worse than no modal — it looks hacked.
 *   3. **A popup button needs both a label and a URL.** A label with no URL is a
 *      button that does nothing; a URL with no label is a button with no text.
 *      Both are silently useless, which is the worst kind of useless.
 *
 * All three read `merged`, never `input` — see the file header for why.
 *
 * 400 and not 403 here: these are not permission problems, they are incoherent
 * requests, and the agency fixes them by typing something rather than by paying.
 */
export function assertCoherent(merged: MergedSiteConfig): void {
  if (merged.topBarEnabled && !merged.topBarText?.trim()) {
    throw httpError(400, "Add top bar text before switching the announcement bar on.");
  }

  if (merged.popupEnabled) {
    if (!merged.popupTitle?.trim()) {
      throw httpError(400, "Add a popup title before switching the popup on.");
    }
    if (!merged.popupBody?.trim()) {
      throw httpError(400, "Add popup body text before switching the popup on.");
    }
  }

  const hasLabel = Boolean(merged.popupCtaLabel?.trim());
  const hasUrl = Boolean(merged.popupCtaUrl?.trim());
  if (hasLabel !== hasUrl) {
    throw httpError(
      400,
      "A popup button needs both a label and a link. Set both, or clear both by sending null.",
    );
  }
}

/* ── 4. Resolution — row + tier + branding → what renders ────────────────── */

/**
 * Build the coming-soon page.
 *
 * Falls back to platform copy per field, not per object: an agency that wrote a
 * headline but no message gets its headline and our message, rather than losing
 * its headline because the pair was incomplete.
 */
export function resolveComingSoon(merged: MergedSiteConfig): ComingSoonPage {
  return {
    headline: merged.constructionHeadline?.trim() || DEFAULT_CONSTRUCTION_COPY.headline,
    message: merged.constructionMessage?.trim() || DEFAULT_CONSTRUCTION_COPY.message,
  };
}

/**
 * Build the announcement bar, or `null` if none should render.
 *
 * `textColor` is **computed, never stored.** Day 1 built `readableTextColor` to
 * pick black or white by relative luminance; running it here means a top bar
 * cannot be configured into white-on-yellow or black-on-navy no matter what the
 * agency picks. One fewer setting, one fewer support ticket, and an
 * accessibility guarantee the platform can actually make.
 *
 * `brandPrimaryColor` is the fallback background: a bar with no colour of its own
 * tracks the brand colour, so changing the brand colour on the Day 1 screen
 * updates the bar too, with nothing to keep in sync.
 */
export function resolveTopBar(
  merged: MergedSiteConfig,
  brandPrimaryColor: string,
): ResolvedTopBar | null {
  const text = merged.topBarText?.trim();
  if (!merged.topBarEnabled || !text) return null;

  const backgroundColor = merged.topBarBackgroundColor ?? brandPrimaryColor;

  return {
    text,
    behavior: merged.topBarBehavior,
    backgroundColor,
    textColor: readableTextColor(backgroundColor),
    linkUrl: merged.topBarLinkUrl,
    dismissible: merged.topBarDismissible,
  };
}

/**
 * Build the popup, or `null` if none should render.
 *
 * The tier check runs **on the read path as well as the write path**, and that is
 * not belt-and-braces — it is the only thing that makes a downgrade work.
 *
 * Picture a Large agency with a configured popup that stops paying and drops to
 * Small. Nothing writes to its `agency_site_config` row; nobody runs a cleanup
 * job. If the tier were only checked when saving, that popup would keep opening
 * on the live site forever, and the agency would have a paid feature it is no
 * longer paying for. Checking here means the feature disappears the instant the
 * tier changes, and reappears intact if it upgrades again — because the *data*
 * was never deleted, only stopped from rendering.
 */
export function resolvePopup(merged: MergedSiteConfig, tier: string): ResolvedPopup | null {
  if (!allowsPopupModal(tier)) return null;
  if (!merged.popupEnabled) return null;

  const title = merged.popupTitle?.trim();
  const body = merged.popupBody?.trim();
  if (!title || !body) return null;

  const hasCta = Boolean(merged.popupCtaLabel?.trim() && merged.popupCtaUrl?.trim());

  return {
    title,
    body,
    ctaLabel: hasCta ? merged.popupCtaLabel : null,
    ctaUrl: hasCta ? merged.popupCtaUrl : null,
    trigger: merged.popupTrigger,
    delaySeconds: merged.popupDelaySeconds,
    frequency: merged.popupFrequency,
  };
}

/**
 * Turn a (possibly missing) row into exactly what the renderer should draw.
 *
 * The ordering rule that matters: **under construction wins over everything.**
 * When the site is showing a coming-soon page, `topBar` and `popup` are `null`
 * regardless of how they are configured. A "20% off Everest!" bar floating above
 * "We'll be back soon" is not a page any agency meant to publish, and the
 * renderer should not be the thing responsible for remembering that.
 *
 * The badge survives under-construction mode on purpose — it is a platform term,
 * not agency content, and the coming-soon page is still a page Funtush is
 * hosting.
 */
export function resolveSiteConfig(
  agency: { tier: string },
  row: SiteConfigRow | null,
  brandPrimaryColor: string,
  /**
   * `Agency.publishedAt !== null` (backend catch-up pass) — passed through
   * untouched rather than decided here, because `underConstruction` and
   * "never published" are deliberately kept as two separate facts in this
   * response (mirroring the frontend's own two separate gates). Combining
   * them into one page-servable boolean is `getSiteLiveness`'s job, not this
   * function's — this one just reports state.
   */
  published: boolean = true,
): ResolvedSiteConfig {
  const merged = withDefaults(row);
  const badge = resolveFuntushBadge(agency.tier, merged.showFuntushBadge);

  if (merged.underConstruction) {
    return {
      underConstruction: true,
      published,
      comingSoon: resolveComingSoon(merged),
      topBar: null,
      popup: null,
      showFuntushBadge: badge,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  return {
    underConstruction: false,
    published,
    comingSoon: null,
    topBar: resolveTopBar(merged, brandPrimaryColor),
    popup: resolvePopup(merged, agency.tier),
    showFuntushBadge: badge,
    updatedAt: row?.updatedAt ?? null,
  };
}

/* ── 5. Reads ────────────────────────────────────────────────────────────── */

/**
 * The dashboard read.
 *
 * Returns the **raw stored values**, not the resolved ones, because a settings
 * form has to show what is saved even when it is not currently rendering. A
 * Small-tier agency that once had a popup must still see its popup copy in the
 * form (greyed out, with an upgrade prompt) rather than an empty box that
 * silently ate its work. That is what `capabilities` is for: the UI disables the
 * control, the server refuses the write, and the text stays visible.
 */
export async function getSiteConfig(agencyId: string): Promise<EditableSiteConfig> {
  const agency = await getAgencyBrandContext(agencyId);
  const row = (await db.agencySiteConfig.findUnique({
    where: { agencyId },
  })) as SiteConfigRow | null;

  const merged = withDefaults(row);

  return {
    tier: agency.tier,
    values: merged,
    capabilities: {
      popupModal: allowsPopupModal(agency.tier),
      funtushBadgeToggle: canToggleFuntushBadge(agency.tier),
      topBarColorMode: allowsFreeColorPicker(agency.tier) ? "free" : "curated",
    },
    effectiveFuntushBadge: resolveFuntushBadge(agency.tier, merged.showFuntushBadge),
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Everything the settings screen needs to draw its pickers. */
export async function getSiteConfigOptions(agencyId: string) {
  const agency = await getAgencyBrandContext(agencyId);

  return {
    tier: agency.tier,
    topBarBehaviors: Object.values(TOP_BAR_BEHAVIORS),
    popupTriggers: Object.values(POPUP_TRIGGERS),
    popupFrequencies: Object.values(POPUP_FREQUENCIES),
    capabilities: {
      popupModal: allowsPopupModal(agency.tier),
      funtushBadgeToggle: canToggleFuntushBadge(agency.tier),
      topBarColorMode: allowsFreeColorPicker(agency.tier) ? "free" : "curated",
    },
    /**
     * Explained to the agency rather than left as a silently disabled switch.
     * "Why can't I turn this off?" is a support ticket; a sentence next to the
     * control is not.
     */
    notes: {
      funtushBadge: isTrialTier(agency.tier)
        ? "Your free trial includes the \"Powered by Funtush\" badge. It is removed on any paid plan."
        : "Your plan lets you show or hide the \"Powered by Funtush\" badge.",
      popupModal: allowsPopupModal(agency.tier)
        ? "Popup modals are included in your plan."
        : "Popup modals are available on the Medium and Large plans.",
    },
  };
}

/**
 * The public read — what the white-label renderer calls on every page view.
 *
 * Branding is loaded in the **same query** as the config, via a nested `include`,
 * for two reasons. The obvious one is a round trip saved on the hottest read in
 * the system. The one that matters more is consistency: the top bar's fallback
 * colour is the brand colour, and fetching the two separately opens a window
 * where a colour change lands between the reads and the bar renders in the old
 * brand colour.
 *
 * A `SUSPENDED` or `LOCKED` agency gets a **404**, matching Day 1 exactly. 403
 * would confirm "this agency exists but is not paying", which is the agency's
 * business and nobody else's.
 */
export async function getPublicSiteConfigBySlug(
  slug: string,
): Promise<ResolvedSiteConfig & { agencySlug: string }> {
  const agency = await db.agency.findUnique({
    where: { slug },
    select: {
      name: true,
      slug: true,
      status: true,
      tier: { select: { name: true } },
      branding: true,
      siteConfig: true,
      publishedAt: true,
    },
  });

  if (!agency) throw httpError(404, "Site not found");
  if (agency.status === "SUSPENDED" || agency.status === "LOCKED") {
    throw httpError(404, "Site not found");
  }

  const tier = agency.tier?.name ?? "FREE";

  // Reuse Day 1's resolver rather than reading `branding.primaryColor` directly:
  // it is the one place the "no row ⇒ DEFAULT_BRANDING" fallback is applied, so
  // an agency with no branding row still gets a teal bar instead of `undefined`.
  const branding = resolveBranding(
    { name: agency.name, tier },
    agency.branding as BrandingRow | null,
  );

  const resolved = resolveSiteConfig(
    { tier },
    agency.siteConfig as SiteConfigRow | null,
    branding.primaryColor,
    agency.publishedAt !== null,
  );

  return { ...resolved, agencySlug: agency.slug };
}

/* ── 6. The write ────────────────────────────────────────────────────────── */

/**
 * Apply a site-config PATCH.
 *
 * The sequence, and why it is this sequence:
 *
 *   1. Load the tier and the existing row.
 *   2. Reject an empty patch — `PATCH {}` is a client bug, and answering 200
 *      hides it.
 *   3. **Tier rules** (403s) before **coherence rules** (400s). A Small-tier
 *      agency sending an incoherent popup patch should be told "your plan does
 *      not include popups", not "your popup needs a title" — the second message
 *      sends it off to write copy for a feature it cannot use.
 *   4. Coherence, against the merged state.
 *   5. One `upsert`, because an agency that has never opened this screen has no
 *      row.
 *   6. **Day 4:** queue the static-site regeneration, after the commit.
 *
 * There are no file uploads here, so unlike Day 1's branding write there is
 * nothing to clean up afterwards — the database part of the operation is a
 * single statement that either happens or does not.
 *
 * This screen is the one where a stale cache is most visible, and it is worth
 * knowing why: `underConstruction` is a switch between two completely different
 * websites. An agency flipping it off is *launching*, and a coming-soon page
 * that lingers at the edge for another cache lifetime is a launch that appears
 * not to have happened. Same hook as Day 1's, higher stakes.
 */
export async function updateSiteConfig(
  agencyId: string,
  input: SiteConfigUpdateInput,
): Promise<EditableSiteConfig & { regeneration: RegenerationReceipt }> {
  const agency = await getAgencyBrandContext(agencyId);
  const existing = (await db.agencySiteConfig.findUnique({
    where: { agencyId },
  })) as SiteConfigRow | null;

  if (Object.keys(input).length === 0) {
    throw httpError(400, "No site configuration fields provided to update");
  }

  // ── Step 3: tier rules first.
  assertPopupAllowed(agency.tier, input);
  assertBadgeChangeAllowed(agency.tier, input);
  assertTopBarColorAllowed(agency.tier, input);

  // ── Step 4: coherence, against row + patch.
  const merged = mergePatch(existing, input);
  assertCoherent(merged);

  /**
   * Build the column patch key by key.
   *
   * Spreading `input` would be shorter and wrong in the same way Day 1's spread
   * would have been: it copies keys whose value is `undefined`. Prisma happens
   * to treat those as "no change" today, but relying on that means the code is
   * correct by coincidence — and it would silently start clearing columns if
   * `undefined` handling ever changed. The explicit loop states the intent.
   */
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) data[key] = value;
  }

  await db.agencySiteConfig.upsert({
    where: { agencyId },
    update: data,
    create: { agencyId, ...data },
  });

  // Re-read through `getSiteConfig` so the response is produced by exactly the
  // same code path as a plain GET. Two builders for one response shape is how a
  // save comes back subtly different from the reload that follows it.
  const config = await getSiteConfig(agencyId);

  // ── Step 6: publish.
  const regeneration = queueRegeneration({
    agencyId,
    slug: agency.slug,
    customDomain: agency.customDomain,
    scopes: ["siteConfig"],
    version: config.updatedAt,
  });

  return { ...config, regeneration };
}

/* ── 7. The guard for public site content ────────────────────────────────── */

/** What a caller needs to know to decide whether to serve a page. */
export interface SiteLiveness {
  live: boolean;
  comingSoon: ComingSoonPage | null;
}

/**
 * Is this agency's public site currently serving content?
 *
 * Split out from `getPublicSiteConfigBySlug` and kept deliberately narrow — it
 * selects a handful of columns, not a whole config — because it is called by
 * middleware in front of *other* routes, and a guard that costs as much as
 * the handler it guards is a guard people take back out.
 *
 * **Two independent reasons a page won't serve** (backend catch-up pass adds
 * the second): `underConstruction` pauses an *already-published* site, and
 * `publishedAt === null` means the site has never gone live at all — the
 * state of every agency before its first Publish. Both collapse to the same
 * "not live" answer here, because this function's one job is the binary
 * "can I serve this page" a content route needs; `getPublicSiteConfigBySlug`
 * is where the two stay distinguishable, for the settings screen that needs
 * to know which one it's looking at.
 *
 * An agency that does not exist is reported as **not live** rather than throwing.
 * The caller (the middleware) turns that into its own 404; making this function
 * throw would mean every caller needs a try/catch to distinguish "missing" from
 * "database is down", and one of them would get it wrong.
 */
export async function getSiteLiveness(slug: string): Promise<SiteLiveness> {
  const agency = await db.agency.findUnique({
    where: { slug },
    select: {
      status: true,
      publishedAt: true,
      siteConfig: {
        select: {
          underConstruction: true,
          constructionHeadline: true,
          constructionMessage: true,
        },
      },
    },
  });

  if (!agency) return { live: false, comingSoon: null };
  if (agency.status === "SUSPENDED" || agency.status === "LOCKED") {
    return { live: false, comingSoon: null };
  }

  const config = agency.siteConfig;
  const paused = Boolean(config?.underConstruction);
  const neverPublished = agency.publishedAt === null;

  if (!paused && !neverPublished) return { live: true, comingSoon: null };

  return {
    live: false,
    comingSoon: {
      headline: config?.constructionHeadline?.trim() || DEFAULT_CONSTRUCTION_COPY.headline,
      message: config?.constructionMessage?.trim() || DEFAULT_CONSTRUCTION_COPY.message,
    },
  };
}
