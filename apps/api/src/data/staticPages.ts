/**
 * ── The static-page dependency map (White-label week · Day 4) ────────────────
 *
 * Days 1–3 built three screens that all change the *same* thing: what a
 * visitor's browser paints. Day 4 is the plumbing that makes a save on any of
 * those screens show up on the live site within seconds instead of within a
 * cache lifetime.
 *
 * Before anything can be regenerated or purged, one question has to be answered
 * precisely: **which cached things did this save invalidate?** That question is
 * pure — it needs no database, no network, and no clock — so it lives here, in
 * a data file, exactly like `brandTheme.ts` (Day 1), `siteConfig.ts` (Day 2) and
 * `navigation.ts` (Day 3).
 *
 * ── The three caches between a save and a visitor ────────────────────────────
 *
 * This is the whole mental model for the day. When an agency saves a colour,
 * that colour has to travel through three layers before a stranger's phone
 * shows it, and **every one of them can hold a stale copy**:
 *
 *   1. **The API's own edge cache.** Day 1–3's public reads answer with
 *      `Cache-Control: public, max-age=15…60`. A CDN in front of
 *      `api.funtush.com` is allowed — encouraged — to keep that JSON.
 *   2. **The renderer's static pages.** The site is pre-rendered HTML, not a
 *      live database query. Until something tells the renderer to rebuild, it
 *      keeps serving the HTML it built from the *old* JSON.
 *   3. **The CDN's copy of that HTML.** Even a freshly rebuilt page is invisible
 *      while the edge still holds the previous one.
 *
 * Miss any layer and the agency reloads its site, sees the old logo, and files a
 * bug that says "branding doesn't save" — even though the database row is
 * perfect. Day 4 exists to clear all three, in the right order (see
 * `regeneration.service.ts`).
 *
 * ── Why tags are primary and URLs are the fallback ───────────────────────────
 *
 * There are two ways to tell a cache "forget this":
 *
 *   - **By URL** — "forget `https://xyz.funtush.io/packages`". Universally
 *     supported, and *unusable on its own here*, because a site has an unknown
 *     number of pages: every published package and every blog post has its own
 *     URL, and all of them carry the header, so all of them go stale when the
 *     menu changes. You cannot enumerate what you do not know.
 *   - **By tag** — "forget everything labelled `branding:xyz`". The renderer
 *     stamps that label on every page that reads branding, so one instruction
 *     covers pages nobody had to list. This is what Next.js calls a cache tag
 *     (`revalidateTag`), Fastly calls a surrogate key, and Cloudflare calls a
 *     cache tag.
 *
 * So the tag list is the real answer and the URL list is a best-effort fallback
 * for a CDN plan that only speaks URLs. Both are built here, from one table, so
 * they can never describe different sets of pages.
 *
 * ⚠️ Like its Day 1–3 siblings, this file must not import `@funtush/database`.
 */

/* ── 1. What can change ──────────────────────────────────────────────────── */

/**
 * The three things an agency can save that alter its public site.
 *
 * One scope per Day 1/2/3 screen, and the names are the *feature's* names, not
 * the table's — a scope is "what the agency thinks it changed", which is what
 * makes a regeneration receipt readable in a support ticket.
 *
 * `socialLinks` and `seoSettings` extend the same table for the social-links
 * and SEO settings screens (backend catch-up pass) — same reasoning, new
 * screens. `sitePage` (Phase 8) is different from all five: it is the only
 * scope that changes actual page *content* (the section list) rather than
 * chrome that wraps every page, which is why `SITE_PAGES`, below, attaches it
 * only to Home instead of to `LAYOUT`.
 */
export type RegenerationScope =
  | "branding"
  | "siteConfig"
  | "navigation"
  | "socialLinks"
  | "seoSettings"
  | "sitePage";

/** Every scope, in the order the screens were built. */
export const REGENERATION_SCOPES: readonly RegenerationScope[] = [
  "branding",
  "siteConfig",
  "navigation",
  "socialLinks",
  "seoSettings",
  "sitePage",
];

/** `true` when `value` is one of the three known scopes. */
export function isRegenerationScope(value: string): value is RegenerationScope {
  return (REGENERATION_SCOPES as readonly string[]).includes(value);
}

/* ── 2. Cache tags ───────────────────────────────────────────────────────── */

/**
 * The tag prefix each scope uses.
 *
 * Kept short because tags travel in an HTTP response header on **every** public
 * request; `branding:` costs nine bytes per response, `agency-branding-scope:`
 * costs twenty-two for no extra meaning.
 *
 * The prefixes are deliberately *not* the table names. A tag is a contract with
 * the renderer and the CDN — renaming a Prisma model should not force a
 * coordinated deploy of three systems.
 */
export const SCOPE_TAG_PREFIX: Record<RegenerationScope, string> = {
  branding: "branding",
  siteConfig: "config",
  navigation: "nav",
  socialLinks: "social",
  seoSettings: "seo",
  sitePage: "page",
};

/**
 * One tag, e.g. `branding:himalayan-trails`.
 *
 * **The slug is part of every tag, and that is the multi-tenancy rule of this
 * file** (Backend Guide §4). A bare `branding` tag would be shared by every
 * agency on the platform, so one agency saving a colour would purge two hundred
 * other sites' caches — a cross-tenant side effect, and a self-inflicted
 * thundering herd on the origin.
 */
export function scopeTag(scope: RegenerationScope, slug: string): string {
  return `${SCOPE_TAG_PREFIX[scope]}:${slug}`;
}

/**
 * Every tag a save with these scopes invalidates.
 *
 * Sorted and de-duplicated so that the same logical save always produces a
 * byte-identical list. That matters more than it looks: the list ends up in a
 * response header, in a purge request body, and in a test assertion, and
 * "sometimes in a different order" turns all three into flaky comparisons.
 */
export function tagsForScopes(
  slug: string,
  scopes: readonly RegenerationScope[],
): string[] {
  const tags = new Set(scopes.map((scope) => scopeTag(scope, slug)));
  return [...tags].sort();
}

/**
 * The value for the `Cache-Tag` response header on a public read.
 *
 * This is the other half of tag-based purging and it is easy to forget: a CDN
 * can only purge by a tag the response *told it about*. `tagsForScopes` builds
 * the purge request; this builds the label that makes the purge request mean
 * something. If Day 1–3's public endpoints never emit the header, every
 * tag-based purge succeeds and clears nothing.
 *
 * Space after the comma is the format Cloudflare and Fastly both accept.
 */
export function cacheTagHeaderValue(
  slug: string,
  scopes: readonly RegenerationScope[],
): string {
  return tagsForScopes(slug, scopes).join(", ");
}

/* ── 3. The page table ───────────────────────────────────────────────────── */

/**
 * The statically generated pages of a white-label site, and what each reads.
 *
 * Read the `dependsOn` column as: *"if any of these scopes changes, this page's
 * HTML is wrong."* Today every page depends on all three, and that is not
 * laziness — branding is the theme, the navigation is the header, and the site
 * config owns the announcement bar and the coming-soon gate, so all three are in
 * the **layout** that wraps every page.
 *
 * The table still earns its place, for two reasons:
 *
 *   1. Tomorrow's scopes are not site-wide. When "a package was published"
 *      becomes a scope, it will touch `/` and `/packages` and nothing else, and
 *      this is the one place that fact will be written down.
 *   2. It is the list a human maintains. A page added to the renderer without a
 *      line here will never be purged by URL, and the failure is silent — one
 *      page on the site that keeps last month's logo. Keeping the list in the
 *      backend next to the purge code is what gives that mistake a place to be
 *      caught in code review.
 *
 * Note what is deliberately absent: `/packages/:slug`, `/blog/:slug`. Detail
 * pages are unbounded and unknowable from here — they are precisely why the tag
 * list, not this table, is the primary mechanism.
 */
export interface SitePage {
  /** Path on the agency's own domain, always starting with `/`. */
  path: string;
  /** A human label, used in regeneration receipts and logs. */
  label: string;
  /** Which scopes make this page's rendered HTML wrong. */
  dependsOn: readonly RegenerationScope[];
}

/** Every scope — the common case, extracted so the table below reads cleanly. */
const LAYOUT: readonly RegenerationScope[] = REGENERATION_SCOPES;

export const SITE_PAGES: readonly SitePage[] = [
  // Home is the page the builder actually renders (Phase 8), so it alone
  // also depends on `sitePage` — every other page here is a separate,
  // hardcoded route the builder does not touch.
  { path: "/", label: "Home", dependsOn: [...LAYOUT, "sitePage"] },
  { path: "/packages", label: "Packages", dependsOn: LAYOUT },
  { path: "/destinations", label: "Destinations", dependsOn: LAYOUT },
  { path: "/about", label: "About", dependsOn: LAYOUT },
  { path: "/contact", label: "Contact", dependsOn: LAYOUT },
  { path: "/blog", label: "Blog", dependsOn: LAYOUT },
];

/** The paths whose HTML these scopes invalidate. */
export function affectedPagePaths(scopes: readonly RegenerationScope[]): string[] {
  return SITE_PAGES.filter((page) =>
    page.dependsOn.some((scope) => scopes.includes(scope)),
  ).map((page) => page.path);
}

/* ── 4. The API reads that feed the renderer ─────────────────────────────── */

/**
 * The public endpoint each scope is served by — Day 1's, Day 2's and Day 3's
 * reads, in one table.
 *
 * `{slug}` is substituted rather than concatenated so the shape of a URL is
 * visible at a glance, and so a future `?format=css` variant has an obvious
 * home.
 */
export const SCOPE_API_PATHS: Record<RegenerationScope, string> = {
  branding: "/site/{slug}/branding",
  siteConfig: "/site/{slug}/config",
  navigation: "/site/{slug}/navigation",
  socialLinks: "/site/{slug}/social-links",
  seoSettings: "/site/{slug}/seo",
  sitePage: "/site/{slug}/site-page",
};

/** `/site/{slug}/branding` → `/site/himalayan-trails/branding`. */
export function apiPathForScope(scope: RegenerationScope, slug: string): string {
  return SCOPE_API_PATHS[scope].replace("{slug}", slug);
}

/* ── 5. Hosts ────────────────────────────────────────────────────────────── */

/**
 * The subdomain every site gets (`xyz.funtush.io`, Backend Guide §4).
 *
 * Read through a function rather than captured in a module constant so a test —
 * or a staging deploy — can set the variable after import. A `const` evaluated
 * at import time is the classic reason "it works locally but the staging purge
 * hits production URLs".
 */
export function siteBaseDomain(): string {
  return process.env.SITE_BASE_DOMAIN || "funtush.io";
}

/** Where the public API is reachable — the host whose JSON the renderer reads. */
export function apiPublicOrigin(): string {
  return stripTrailingSlash(process.env.API_PUBLIC_URL || "https://api.funtush.com");
}

/** Drop one trailing `/`, so joining a path can never produce `//packages`. */
function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Turn a stored custom domain into a host we are willing to build a URL from.
 *
 * The column is free text an agency typed months ago, and it has been seen as
 * `https://www.x.com`, `www.x.com/`, and `  WWW.X.COM `. All three mean the same
 * site; only one of them concatenates into a valid URL.
 *
 * The character check is a **whitelist**, matching Day 3's `isSafeInternalPath`:
 * letters, digits, dots and hyphens are what a hostname is made of, and anything
 * else — a space, a slash, an `@`, a `?` — means the value is not a hostname and
 * we return `null` rather than guessing. Returning `null` costs one un-purged
 * edge cache; guessing costs a purge request aimed at a URL we constructed out
 * of somebody else's input.
 */
export function normalizeCustomDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let host = raw.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "");
  host = stripTrailingSlash(host);

  if (!host) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  // A hostname with no dot is not a public domain — it is a typo, or `localhost`.
  if (!host.includes(".")) return null;

  return host;
}

/** The identity bits of an agency this module needs. No Prisma types here. */
export interface SiteHostContext {
  slug: string;
  customDomain?: string | null;
}

/**
 * Every origin this site is reachable at.
 *
 * **A site with a custom domain has two live caches, not one.** The subdomain
 * keeps working after a custom domain is mapped (it is what the dashboard links
 * to, and what DNS falls back to), so purging only the pretty URL leaves the
 * `*.funtush.io` copy stale — which is exactly the URL the agency's own staff
 * have bookmarked. Both, always.
 */
export function siteOrigins(agency: SiteHostContext): string[] {
  const origins = [`https://${agency.slug}.${siteBaseDomain()}`];

  const custom = normalizeCustomDomain(agency.customDomain);
  if (custom) origins.push(`https://${custom}`);

  return origins;
}

/* ── 6. The targets of one regeneration ──────────────────────────────────── */

/** Everything a single save invalidates, ready to hand to the purge clients. */
export interface RegenerationTargets {
  /** The precise instruction: purge everything labelled with these. */
  tags: string[];
  /** The JSON reads the renderer will make — purge these *first*. */
  apiUrls: string[];
  /** The rendered HTML — purge these *last*, after the rebuild. */
  pageUrls: string[];
  /** Site-relative paths, for a renderer that revalidates by path. */
  paths: string[];
}

/**
 * Work out everything one save invalidates.
 *
 * The split into `apiUrls` and `pageUrls` is not cosmetic — it is the *order* of
 * the pipeline, expressed as data. The API JSON must be uncached before the
 * renderer rebuilds (or it rebuilds from stale data and confidently caches the
 * old logo for another cycle), and the page HTML must be uncached after the
 * rebuild (or the edge re-fetches the not-yet-rebuilt page and re-caches the
 * staleness it was just told to drop). `regeneration.service.ts` consumes them
 * in that order; keeping them as two fields makes getting it wrong require
 * typing the wrong field name.
 *
 * An empty `scopes` array yields empty everything rather than "everything" —
 * "nothing changed" must never accidentally mean "purge the world".
 */
export function buildRegenerationTargets(
  agency: SiteHostContext,
  scopes: readonly RegenerationScope[],
): RegenerationTargets {
  if (scopes.length === 0) {
    return { tags: [], apiUrls: [], pageUrls: [], paths: [] };
  }

  const uniqueScopes = [...new Set(scopes)];
  const paths = affectedPagePaths(uniqueScopes);
  const apiOrigin = apiPublicOrigin();

  const apiUrls = uniqueScopes
    .map((scope) => `${apiOrigin}${apiPathForScope(scope, agency.slug)}`)
    .sort();

  const pageUrls = siteOrigins(agency)
    .flatMap((origin) => paths.map((path) => `${origin}${path}`))
    .sort();

  return {
    tags: tagsForScopes(agency.slug, uniqueScopes),
    apiUrls,
    pageUrls,
    paths,
  };
}
