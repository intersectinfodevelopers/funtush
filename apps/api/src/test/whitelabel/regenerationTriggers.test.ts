import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ── Regeneration triggers and precise invalidation (White-label week · Day 5) ─
 *
 * Day 4 shipped two suites, and between them they leave one gap that this file
 * exists to close:
 *
 *   - `regeneration.service.test.ts` drives the pipeline directly. It proves the
 *     order, the retries and the coalescing are right — but it calls
 *     `queueRegeneration` itself, so it cannot prove a *save* ever calls it.
 *   - `regeneration.hooks.test.ts` drives the saves. It proves each write path
 *     calls the hook — but the hook is a stub there, so it cannot prove anything
 *     about what the CDN is actually asked to forget.
 *
 * This file joins the two ends: a **real** `PATCH` handler, the **real**
 * regeneration service, and only the two HTTP clients replaced by spies. What it
 * asserts is the sentence the day's task is written in:
 *
 *   > *the static regeneration triggers correctly and the cache invalidates
 *   > precisely.*
 *
 * "Precisely" is a two-sided requirement and both sides are bugs:
 *
 *   - **Not enough.** Miss a URL and the agency reloads its site, sees the old
 *     logo, and reports that saving does nothing. Miss the *second* origin — the
 *     `*.funtush.io` subdomain that keeps working after a custom domain is mapped
 *     — and the site looks fixed to the customer and broken to the agency's own
 *     staff, who have the subdomain bookmarked.
 *   - **Too much.** Purge a tag without the tenant's slug in it and one agency
 *     saving a colour empties two hundred other agencies' caches, which is both a
 *     cross-tenant side effect (Backend Guide §4) and a self-inflicted stampede
 *     on the origin.
 *
 * So most of the assertions below are *exact set equality*, not `toContain`. A
 * containment check passes when the platform purges the whole world.
 */

/* ── Test doubles ────────────────────────────────────────────────────────── */

const agencyFindUnique = vi.fn();
const brandingFindUnique = vi.fn();
const brandingUpsert = vi.fn();
const siteConfigFindUnique = vi.fn();
const siteConfigUpsert = vi.fn();
const navigationFindUnique = vi.fn();
const navigationUpsert = vi.fn();
const itemDeleteMany = vi.fn();
const itemCreate = vi.fn();
const socialLinksFindUnique = vi.fn();
const socialLinksUpsert = vi.fn();
const seoSettingsFindUnique = vi.fn();
const seoSettingsUpsert = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    agency: { findUnique: (...a: unknown[]) => agencyFindUnique(...a) },
    agencyBranding: {
      findUnique: (...a: unknown[]) => brandingFindUnique(...a),
      upsert: (...a: unknown[]) => brandingUpsert(...a),
    },
    agencySiteConfig: {
      findUnique: (...a: unknown[]) => siteConfigFindUnique(...a),
      upsert: (...a: unknown[]) => siteConfigUpsert(...a),
    },
    agencyNavigation: {
      findUnique: (...a: unknown[]) => navigationFindUnique(...a),
      upsert: (...a: unknown[]) => navigationUpsert(...a),
    },
    agencyNavigationItem: {
      deleteMany: (...a: unknown[]) => itemDeleteMany(...a),
      create: (...a: unknown[]) => itemCreate(...a),
    },
    agencySocialLinks: {
      findUnique: (...a: unknown[]) => socialLinksFindUnique(...a),
      upsert: (...a: unknown[]) => socialLinksUpsert(...a),
    },
    agencySeoSettings: {
      findUnique: (...a: unknown[]) => seoSettingsFindUnique(...a),
      upsert: (...a: unknown[]) => seoSettingsUpsert(...a),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        agencyNavigation: { upsert: (...a: unknown[]) => navigationUpsert(...a) },
        agencyNavigationItem: {
          deleteMany: (...a: unknown[]) => itemDeleteMany(...a),
          create: (...a: unknown[]) => itemCreate(...a),
        },
      }),
  },
}));

vi.mock("@funtush/storage", () => ({
  uploadFile: vi.fn(async () => "https://cdn.funtush.com/uploads/x.png"),
  deleteFile: vi.fn(async () => undefined),
}));

/**
 * Only the two network clients are faked. Everything between a `PATCH` and these
 * two functions is the real code, which is the point: the thing being tested is
 * the wiring, and wiring is exactly what a stubbed middle layer hides.
 */
const purgeCdnMock = vi.fn();
const revalidateSiteMock = vi.fn();
const cdnEnabled = vi.fn(() => true);
const rendererEnabled = vi.fn(() => true);

vi.mock("../../lib/cdn", () => ({
  purgeCdn: (...args: unknown[]) => purgeCdnMock(...args),
  isCdnPurgeEnabled: () => cdnEnabled(),
}));

vi.mock("../../lib/isr", () => ({
  revalidateSite: (...args: unknown[]) => revalidateSiteMock(...args),
  isRendererEnabled: () => rendererEnabled(),
}));

import { cacheTagHeaderValue, type RegenerationScope } from "../../data/staticPages";
import {
  flushRegenerations,
  getLastRegeneration,
  resetRegenerationState,
} from "../../services/regeneration.service";
import { updateAgencyBranding } from "../../services/branding.service";
import { updateSiteConfig } from "../../services/siteConfig.service";
import { updateNavigation } from "../../services/navigation.service";
import { updateSocialLinks } from "../../services/socialLinks.service";
import { updateSeoSettings } from "../../services/seoSettings.service";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const AGENCY_ID = "agency-1";
const SLUG = "himalayan-trails";
const CUSTOM_DOMAIN = "everest-treks.com";
const SAVED_AT = new Date("2026-08-14T09:30:00.000Z");

/** A second tenant, used to prove one agency's save cannot touch another's cache. */
const OTHER_AGENCY_ID = "agency-2";
const OTHER_SLUG = "annapurna-base";

/**
 * The six statically generated pages of a white-label site.
 *
 * Written out as literals rather than imported from `SITE_PAGES`, on purpose:
 * comparing the purge list against the same table that produced it would pass no
 * matter what either one said. These are the URLs a human expects to be purged
 * when an agency saves its branding, and if the table changes, this test should
 * have to be changed too — deliberately, by someone who has thought about it.
 */
const EXPECTED_PAGE_URLS = [
  "https://everest-treks.com/",
  "https://everest-treks.com/about",
  "https://everest-treks.com/blog",
  "https://everest-treks.com/contact",
  "https://everest-treks.com/destinations",
  "https://everest-treks.com/packages",
  "https://himalayan-trails.funtush.io/",
  "https://himalayan-trails.funtush.io/about",
  "https://himalayan-trails.funtush.io/blog",
  "https://himalayan-trails.funtush.io/contact",
  "https://himalayan-trails.funtush.io/destinations",
  "https://himalayan-trails.funtush.io/packages",
];

/** The public read each scope is served by — the JSON the renderer re-fetches. */
const EXPECTED_API_URL: Record<RegenerationScope, string> = {
  branding: "https://api.funtush.com/site/himalayan-trails/branding",
  siteConfig: "https://api.funtush.com/site/himalayan-trails/config",
  navigation: "https://api.funtush.com/site/himalayan-trails/navigation",
  socialLinks: "https://api.funtush.com/site/himalayan-trails/social-links",
  seoSettings: "https://api.funtush.com/site/himalayan-trails/seo",
  sitePage: "https://api.funtush.com/site/himalayan-trails/site-page",
};

/** The cache tag each scope's save invalidates, tenant slug included. */
const EXPECTED_TAG: Record<RegenerationScope, string> = {
  branding: "branding:himalayan-trails",
  siteConfig: "config:himalayan-trails",
  navigation: "nav:himalayan-trails",
  socialLinks: "social:himalayan-trails",
  seoSettings: "seo:himalayan-trails",
  sitePage: "page:himalayan-trails",
};

function agencyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENCY_ID,
    name: "Himalayan Trails",
    slug: SLUG,
    status: "ACTIVE",
    customDomain: CUSTOM_DOMAIN,
    tier: { name: "LARGE" },
    ...overrides,
  };
}

/* ── Fake client outcomes ───────────────────────────────────────────────── */

function purged() {
  return { status: "purged", urls: 1, tags: 1, requests: 1, durationMs: 1 };
}

function purgeFailed(error = "CDN purge responded 500") {
  return { status: "failed", urls: 1, tags: 1, requests: 1, durationMs: 1, error };
}

function revalidated() {
  return { status: "revalidated", tags: 1, paths: 6, durationMs: 5 };
}

function skippedPurge() {
  return { status: "skipped", urls: 0, tags: 0, requests: 0, durationMs: 0 };
}

function skippedRevalidate() {
  return { status: "skipped", tags: 0, paths: 0, durationMs: 0 };
}

/** One call's argument object, typed loosely because it crossed a mock boundary. */
type PurgeCall = { urls?: string[]; tags?: string[]; reason?: string };
type RevalidateCall = {
  slug: string;
  scopes: string[];
  tags: string[];
  paths: string[];
  version: number;
};

function purgeCallAt(index: number): PurgeCall {
  return purgeCdnMock.mock.calls[index]![0] as PurgeCall;
}

function revalidateCallAt(index: number): RevalidateCall {
  return revalidateSiteMock.mock.calls[index]![0] as RevalidateCall;
}

/** A `Promise` whose resolution this test controls — for the coalescing test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function statusOf(run: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await run();
    return undefined;
  } catch (err) {
    return (err as { status?: number }).status;
  }
}

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  resetRegenerationState();

  // Read per call by `data/staticPages.ts`, never captured at import time — so
  // setting them here genuinely affects the URLs built below.
  process.env.SITE_BASE_DOMAIN = "funtush.io";
  process.env.API_PUBLIC_URL = "https://api.funtush.com";

  cdnEnabled.mockReturnValue(true);
  rendererEnabled.mockReturnValue(true);
  purgeCdnMock.mockResolvedValue(purged());
  revalidateSiteMock.mockResolvedValue(revalidated());

  agencyFindUnique.mockResolvedValue(agencyRow());

  brandingFindUnique.mockResolvedValue(null);
  brandingUpsert.mockResolvedValue({
    brandName: "Himalayan Trails",
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    paletteId: null,
    fontFamily: null,
    cardImageRatio: "RATIO_4_3",
    currencyCode: "NPR",
    currencySymbol: null,
    currencyDisplay: "SYMBOL",
    updatedAt: SAVED_AT,
  });

  siteConfigFindUnique.mockResolvedValue({ updatedAt: SAVED_AT });
  siteConfigUpsert.mockResolvedValue({});

  navigationFindUnique.mockResolvedValue({
    bookNowLabel: null,
    bookNowHidden: false,
    items: [],
    updatedAt: SAVED_AT,
  });
  navigationUpsert.mockResolvedValue({ id: "nav-1" });
  itemDeleteMany.mockResolvedValue({ count: 0 });
  itemCreate.mockResolvedValue({ id: "item-1" });

  socialLinksFindUnique.mockResolvedValue({
    facebookUrl: null,
    instagramUrl: null,
    tiktokUrl: null,
    whatsappNumber: null,
    youtubeUrl: null,
    updatedAt: SAVED_AT,
  });
  socialLinksUpsert.mockResolvedValue({});

  seoSettingsFindUnique.mockResolvedValue({
    metaTitle: null,
    metaDescription: null,
    ogImageUrl: null,
    updatedAt: SAVED_AT,
  });
  seoSettingsUpsert.mockResolvedValue({});
});

afterEach(async () => {
  // A pipeline still running when the next test starts is how a suite develops a
  // failure that only appears in a particular file order.
  await flushRegenerations();
  resetRegenerationState();
  process.env = { ...originalEnv };
});

/* ── 1. A save triggers the pipeline ─────────────────────────────────────── */

describe("every white-label save triggers a regeneration", () => {
  /**
   * One row per Day 1/2/3 screen. Each entry performs a *minimal legal* save —
   * the smallest change that still commits — because the trigger must not depend
   * on how much was changed.
   */
  const SAVES: Array<{ scope: RegenerationScope; save: () => Promise<unknown> }> = [
    { scope: "branding", save: () => updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" }) },
    { scope: "siteConfig", save: () => updateSiteConfig(AGENCY_ID, { underConstruction: false }) },
    { scope: "navigation", save: () => updateNavigation(AGENCY_ID, { bookNowHidden: true }) },
    { scope: "socialLinks", save: () => updateSocialLinks(AGENCY_ID, { facebookUrl: "https://facebook.com/himalayan-trails" }) },
    { scope: "seoSettings", save: () => updateSeoSettings(AGENCY_ID, { metaTitle: "Himalayan Trails" }) },
  ];

  for (const { scope, save } of SAVES) {
    it(`fires for a ${scope} save, and purges only that scope's JSON first`, async () => {
      await save();
      await flushRegenerations();

      // Two purges: step 1 (the API JSON) and step 3 (the page HTML).
      expect(purgeCdnMock).toHaveBeenCalledTimes(2);
      expect(revalidateSiteMock).toHaveBeenCalledTimes(1);

      // Exactly one API URL — this scope's, and no other scope's. A branding save
      // that also dropped the navigation JSON would work, but it would rebuild
      // pages nobody changed on every single save.
      expect(purgeCallAt(0).urls).toEqual([EXPECTED_API_URL[scope]]);
      expect(revalidateCallAt(0).tags).toEqual([EXPECTED_TAG[scope]]);
    });
  }

  it("hands the save a receipt it can put in the HTTP response", async () => {
    const result = await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });

    expect(result.regeneration.slug).toBe(SLUG);
    expect(result.regeneration.scopes).toEqual(["branding"]);
    // The version published is the saved row's own `updatedAt`, not "now" — so
    // what the renderer is told to publish is what the database actually holds.
    expect(result.regeneration.version).toBe(SAVED_AT.getTime());

    await flushRegenerations();
    expect(getLastRegeneration(AGENCY_ID)?.status).toBe("succeeded");
  });

  it("does not make the agency wait for the CDN", async () => {
    // `queueRegeneration` is not `async`: the receipt comes back before any
    // network call is awaited. If the save ever started awaiting the pipeline,
    // a slow Cloudflare would become a slow Save button.
    const result = await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });

    expect(["queued", "running"]).toContain(result.regeneration.status);
  });
});

/* ── 2. Exactly what gets invalidated ────────────────────────────────────── */

describe("the invalidation is precise", () => {
  it("purges the API read, then rebuilds, then purges every page URL", async () => {
    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    // ── Step 1: the JSON the renderer is about to read.
    expect(purgeCallAt(0).urls).toEqual([EXPECTED_API_URL.branding]);
    // …and **no tags**. The same tags are stamped on the page responses, so a tag
    // purge here would drop the site's HTML *before* the rebuild — precisely the
    // ordering bug the three-step pipeline exists to avoid.
    expect(purgeCallAt(0).tags).toBeUndefined();

    // ── Step 2: rebuild, told both the precise instruction and the fallback.
    expect(revalidateCallAt(0)).toMatchObject({
      slug: SLUG,
      scopes: ["branding"],
      tags: [EXPECTED_TAG.branding],
      paths: ["/", "/packages", "/destinations", "/about", "/contact", "/blog"],
      version: SAVED_AT.getTime(),
    });

    // ── Step 3: the HTML, now that a fresh version exists. Exact equality, both
    // origins, sorted — not `toContain`, which would pass if the platform purged
    // the entire internet.
    expect(purgeCallAt(1).urls).toEqual(EXPECTED_PAGE_URLS);
    expect(purgeCallAt(1).tags).toEqual([EXPECTED_TAG.branding]);
  });

  it("purges both origins, because a mapped domain is a second live cache", async () => {
    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    const urls = purgeCallAt(1).urls ?? [];

    // The pretty domain the customer visits…
    expect(urls.filter((u) => u.startsWith(`https://${CUSTOM_DOMAIN}`))).toHaveLength(6);
    // …and the subdomain the agency's own staff have bookmarked, which keeps
    // working forever after a custom domain is mapped.
    expect(urls.filter((u) => u.startsWith(`https://${SLUG}.funtush.io`))).toHaveLength(6);
  });

  it("purges only the subdomain when no domain is mapped", async () => {
    agencyFindUnique.mockResolvedValue(agencyRow({ customDomain: null }));

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    expect(purgeCallAt(1).urls).toEqual(
      EXPECTED_PAGE_URLS.filter((u) => u.includes("funtush.io")),
    );
  });

  it("ignores an unusable stored domain instead of building a broken URL", async () => {
    // The column is free text an agency typed months ago. `null` costs one
    // un-purged edge cache; guessing costs a purge request aimed at a URL built
    // out of somebody else's input.
    agencyFindUnique.mockResolvedValue(agencyRow({ customDomain: "not a domain/../x" }));

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    for (const url of purgeCallAt(1).urls ?? []) {
      expect(url.startsWith("https://himalayan-trails.funtush.io")).toBe(true);
    }
  });

  it("never builds a URL with a doubled slash, whatever the API origin looks like", async () => {
    process.env.API_PUBLIC_URL = "https://api.funtush.com/";

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    for (const url of [...(purgeCallAt(0).urls ?? []), ...(purgeCallAt(1).urls ?? [])]) {
      expect(url.slice("https://".length)).not.toContain("//");
    }
  });
});

/* ── 3. The tag contract with the public reads ───────────────────────────── */

describe("the tags purged are the tags the public reads advertise", () => {
  /**
   * This is the half of tag-based purging that is easy to forget, and its failure
   * mode is the most expensive kind: **everything looks like it works.** A CDN can
   * only purge by a tag the response told it about, via a `Cache-Tag` header. If
   * the header and the purge ever name different tags, every purge returns 200
   * and clears nothing — and the only symptom is an agency insisting its site did
   * not update.
   *
   * `cacheTagHeaderValue` is the exact function the three public controllers call
   * to build that header, so comparing against it here compares the two ends of
   * the contract rather than two copies of one guess.
   */
  const CASES: Array<{ scope: RegenerationScope; save: () => Promise<unknown> }> = [
    { scope: "branding", save: () => updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" }) },
    { scope: "siteConfig", save: () => updateSiteConfig(AGENCY_ID, { underConstruction: false }) },
    { scope: "navigation", save: () => updateNavigation(AGENCY_ID, { bookNowHidden: true }) },
  ];

  for (const { scope, save } of CASES) {
    it(`${scope}: the purge names exactly the header value the public read sets`, async () => {
      await save();
      await flushRegenerations();

      const headerValue = cacheTagHeaderValue(SLUG, [scope]);

      expect(headerValue).toBe(EXPECTED_TAG[scope]);
      expect(purgeCallAt(1).tags).toEqual([headerValue]);
      expect(revalidateCallAt(0).tags).toEqual([headerValue]);
    });
  }

  it("puts the tenant's slug in every tag, so one save cannot clear another site", async () => {
    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    for (const tag of purgeCallAt(1).tags ?? []) {
      // A bare `branding` tag would be shared by every agency on the platform.
      expect(tag).toContain(`:${SLUG}`);
      expect(tag).not.toBe("branding");
    }
  });
});

/* ── 4. Multi-tenancy ────────────────────────────────────────────────────── */

describe("one agency's save never touches another agency's cache", () => {
  it("keeps two tenants' purge targets completely disjoint", async () => {
    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    const first = [
      ...(purgeCallAt(0).urls ?? []),
      ...(purgeCallAt(1).urls ?? []),
      ...(purgeCallAt(1).tags ?? []),
    ];

    purgeCdnMock.mockClear();
    revalidateSiteMock.mockClear();

    agencyFindUnique.mockResolvedValue(
      agencyRow({ id: OTHER_AGENCY_ID, slug: OTHER_SLUG, customDomain: null }),
    );

    await updateAgencyBranding(OTHER_AGENCY_ID, { brandName: "Annapurna Base" });
    await flushRegenerations();

    const second = [
      ...(purgeCallAt(0).urls ?? []),
      ...(purgeCallAt(1).urls ?? []),
      ...(purgeCallAt(1).tags ?? []),
    ];

    // Nothing in either list mentions the other tenant, in either direction.
    for (const entry of first) expect(entry, entry).not.toContain(OTHER_SLUG);
    for (const entry of second) expect(entry, entry).not.toContain(SLUG);
    expect(second.some((entry) => first.includes(entry))).toBe(false);
  });

  it("records the receipt against the agency that saved, not globally", async () => {
    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    expect(getLastRegeneration(AGENCY_ID)?.slug).toBe(SLUG);
    expect(getLastRegeneration(OTHER_AGENCY_ID)).toBeNull();
  });
});

/* ── 5. Order ────────────────────────────────────────────────────────────── */

describe("the three steps run in the only order that is correct", () => {
  it("API purge → rebuild → page purge, end to end from a real save", async () => {
    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    // `invocationCallOrder` is a global counter across all spies, which is what
    // makes it able to interleave two different mocks. Asserting the numbers are
    // increasing across the two spies is the only way to prove the *sequence*
    // rather than merely that all three happened.
    const apiPurge = purgeCdnMock.mock.invocationCallOrder[0]!;
    const rebuild = revalidateSiteMock.mock.invocationCallOrder[0]!;
    const pagePurge = purgeCdnMock.mock.invocationCallOrder[1]!;

    expect(apiPurge).toBeLessThan(rebuild);
    expect(rebuild).toBeLessThan(pagePurge);
  });

  it("does not purge the pages when the rebuild failed", async () => {
    // Half of this sequence is worse than none of it: purging the HTML after a
    // failed rebuild makes the edge re-fetch the *old* page and cache it again
    // for a full lifetime, with a fresh timestamp on it.
    revalidateSiteMock.mockResolvedValue({
      status: "failed",
      tags: 1,
      paths: 6,
      durationMs: 3,
      error: "renderer responded 500",
    });

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    // Three attempts, each stopping after step 1 — never a step 3.
    for (const call of purgeCdnMock.mock.calls) {
      expect((call[0] as PurgeCall).urls).toEqual([EXPECTED_API_URL.branding]);
    }
    expect(getLastRegeneration(AGENCY_ID)?.status).toBe("failed");
  }, 15000);

  it("never rebuilds from JSON it failed to uncache", async () => {
    purgeCdnMock.mockResolvedValue(purgeFailed());

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    // If step 1 fails, the renderer would faithfully rebuild the site from stale
    // JSON and stamp a fresh timestamp on it — the worst outcome available, since
    // now the wrong content looks new.
    expect(revalidateSiteMock).not.toHaveBeenCalled();
  }, 15000);
});

/* ── 6. A refused save invalidates nothing ───────────────────────────────── */

describe("a rejected save purges nothing at all", () => {
  /**
   * The hooks suite proves the *hook* is not called. This proves no **network
   * call** happens either — a stronger statement, and the one that matters, since
   * a purge forces a rebuild. Firing one on invalid input would let any client
   * make the platform rebuild a site by sending a request it knows will be
   * refused: an origin stampede triggered by a 403, which is the shape of a
   * denial-of-service bug rather than merely wasted work.
   */
  it("a tier 403 on the colour picker", async () => {
    agencyFindUnique.mockResolvedValue(agencyRow({ tier: { name: "SMALL" } }));

    expect(await statusOf(() => updateAgencyBranding(AGENCY_ID, { primaryColor: "#123456" }))).toBe(
      403,
    );
    await flushRegenerations();

    expect(purgeCdnMock).not.toHaveBeenCalled();
    expect(revalidateSiteMock).not.toHaveBeenCalled();
  });

  it("a tier 403 on the navigation builder", async () => {
    agencyFindUnique.mockResolvedValue(agencyRow({ tier: { name: "FREE" } }));

    expect(
      await statusOf(() =>
        updateNavigation(AGENCY_ID, {
          items: [{ label: "Treks", linkType: "INTERNAL", url: "/packages" }],
        }),
      ),
    ).toBe(403);
    await flushRegenerations();

    expect(purgeCdnMock).not.toHaveBeenCalled();
  });

  it("a 400 for an incoherent site configuration", async () => {
    siteConfigFindUnique.mockResolvedValue({ updatedAt: SAVED_AT, topBarText: null });

    expect(await statusOf(() => updateSiteConfig(AGENCY_ID, { topBarEnabled: true }))).toBe(400);
    await flushRegenerations();

    expect(purgeCdnMock).not.toHaveBeenCalled();
  });

  it("a 400 for an empty patch, on all three screens", async () => {
    expect(await statusOf(() => updateAgencyBranding(AGENCY_ID, {}))).toBe(400);
    expect(await statusOf(() => updateSiteConfig(AGENCY_ID, {}))).toBe(400);
    expect(await statusOf(() => updateNavigation(AGENCY_ID, {}))).toBe(400);
    await flushRegenerations();

    expect(purgeCdnMock).not.toHaveBeenCalled();
  });

  it("a 404 for an agency that does not exist", async () => {
    agencyFindUnique.mockResolvedValue(null);

    expect(await statusOf(() => updateAgencyBranding(AGENCY_ID, { brandName: "X" }))).toBe(404);
    await flushRegenerations();

    expect(purgeCdnMock).not.toHaveBeenCalled();
  });
});

/* ── 7. Rapid saves coalesce instead of stampeding ───────────────────────── */

describe("saving three screens in a minute rebuilds the site once, not three times", () => {
  it("folds the waiting saves together and purges the union exactly once", async () => {
    /**
     * The real usage pattern this exists for: an agency setting up its site saves
     * branding, then the menu, then the top bar, inside a minute. Three full
     * pipelines would rebuild the same site three times and purge the same twelve
     * URLs three times — and the first two rebuilds are already obsolete before
     * they finish.
     *
     * The first purge is held open so the second and third saves land while a
     * pipeline is genuinely in flight. Without that, the mocks resolve instantly
     * and the saves never overlap, which would make this test pass for the wrong
     * reason.
     */
    const held = deferred<ReturnType<typeof purged>>();
    purgeCdnMock.mockReturnValueOnce(held.promise);

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await updateNavigation(AGENCY_ID, { bookNowHidden: true });
    await updateSiteConfig(AGENCY_ID, { underConstruction: false });

    held.resolve(purged());
    await flushRegenerations();

    // Two pipelines, not three: the first ran, and the two that arrived while it
    // was busy merged into one.
    expect(revalidateSiteMock).toHaveBeenCalledTimes(2);

    // The merged pipeline carries both waiting scopes and both of their tags —
    // nothing is dropped by coalescing, it is only batched.
    const merged = revalidateCallAt(1);
    expect([...merged.scopes].sort()).toEqual(["navigation", "siteConfig"]);
    expect(merged.tags).toEqual([EXPECTED_TAG.navigation, EXPECTED_TAG.siteConfig].sort());

    // And it purges the union of their API reads — still not the branding one,
    // which the first pipeline already handled.
    expect(purgeCallAt(2).urls).toEqual(
      [EXPECTED_API_URL.navigation, EXPECTED_API_URL.siteConfig].sort(),
    );
  });

  it("does not make two different sites wait for each other", async () => {
    // Coalescing is keyed on the slug. Two agencies saving at the same moment are
    // unrelated events, and serialising them would turn one busy tenant into
    // everybody's latency.
    const held = deferred<ReturnType<typeof purged>>();
    purgeCdnMock.mockReturnValueOnce(held.promise);

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });

    agencyFindUnique.mockResolvedValue(
      agencyRow({ id: OTHER_AGENCY_ID, slug: OTHER_SLUG, customDomain: null }),
    );
    await updateAgencyBranding(OTHER_AGENCY_ID, { brandName: "Annapurna Base" });

    // The second site's pipeline started even though the first is still blocked.
    expect(purgeCdnMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    held.resolve(purged());
    await flushRegenerations();

    expect(getLastRegeneration(OTHER_AGENCY_ID)?.status).toBe("succeeded");
  });
});

/* ── 8. The CDN can never break a save ───────────────────────────────────── */

describe("the edge is allowed to fail; the save is not", () => {
  it("still returns a successful save when every purge fails", async () => {
    purgeCdnMock.mockResolvedValue(purgeFailed());

    // The row is committed and the data is correct. Reporting a failed save here
    // would be a lie, and would invite the agency to save again — which purges
    // again, against a CDN that is already unwell.
    const result = await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });

    // It resolved rather than throwing, and the row really was written — the two
    // things "the save succeeded" actually means. (`result.brandName` reflects
    // the mocked upsert's return value, not the input, so it would prove nothing
    // here.)
    expect(result.regeneration).toBeDefined();
    expect(brandingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { brandName: "Himalaya Co" } }),
    );

    await flushRegenerations();

    // The failure is recorded where an operator can see it, not thrown at a user.
    const receipt = getLastRegeneration(AGENCY_ID);
    expect(receipt?.status).toBe("failed");
    expect(receipt?.error).toContain("CDN purge responded 500");
  }, 15000);

  it("reports 'skipped', not 'succeeded', on a laptop with nothing configured", async () => {
    // A developer running the API locally has no Cloudflare zone and should not
    // need one to save a colour. Equally, an unwired staging environment must not
    // look healthy — hence a third status rather than folding this into either
    // neighbour.
    cdnEnabled.mockReturnValue(false);
    rendererEnabled.mockReturnValue(false);
    purgeCdnMock.mockResolvedValue(skippedPurge());
    revalidateSiteMock.mockResolvedValue(skippedRevalidate());

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    expect(getLastRegeneration(AGENCY_ID)?.status).toBe("skipped");
  });

  it("retries a transient failure rather than giving up on the first one", async () => {
    purgeCdnMock.mockResolvedValueOnce(purgeFailed("CDN purge responded 502"));

    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });
    await flushRegenerations();

    const receipt = getLastRegeneration(AGENCY_ID);
    expect(receipt?.status).toBe("succeeded");
    expect(receipt?.attempts).toBe(2);
  }, 15000);
});
