import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the static site regeneration hook (White-label week · Day 4).
 *
 * The two HTTP clients are replaced with spies. That is not laziness about
 * integration testing — it is the only way to assert the thing this service
 * actually owns, which is **order and control flow**:
 *
 *   1. The API cache is purged *before* the renderer is asked to rebuild, and
 *      the page cache *after*. Get this wrong and the platform confidently
 *      caches stale content with a fresh timestamp, which is worse than not
 *      purging at all.
 *   2. A failed step stops the pipeline instead of continuing.
 *   3. A save is never slowed down or failed by any of it.
 *   4. Rapid saves for one site coalesce instead of stampeding.
 *
 * Both clients already have their own suites (`lib/cdn.test.ts`,
 * `lib/isr.test.ts`) proving they never throw, so this file gets to assume it.
 */

const purgeCdnMock = vi.fn();
const revalidateSiteMock = vi.fn();
const cdnEnabled = vi.fn(() => true);
const rendererEnabled = vi.fn(() => true);

vi.mock("../lib/cdn", () => ({
  purgeCdn: (...args: unknown[]) => purgeCdnMock(...args),
  isCdnPurgeEnabled: () => cdnEnabled(),
}));

vi.mock("../lib/isr", () => ({
  revalidateSite: (...args: unknown[]) => revalidateSiteMock(...args),
  isRendererEnabled: () => rendererEnabled(),
}));

import {
  MAX_REGENERATION_ATTEMPTS,
  REGENERATION_HISTORY_LIMIT,
  createReceipt,
  flushRegenerations,
  getLastRegeneration,
  getRegenerationCapabilities,
  getRegenerationHistory,
  queueRegeneration,
  resetRegenerationState,
  runRegeneration,
  type RegenerationReceipt,
} from "./regeneration.service";

const AGENCY_ID = "agency-1";
const SLUG = "himalayan-trails";

/** Retries with no waiting — the delays are tested separately from the logic. */
const FAST = { retryDelaysMs: [0, 0] };

const originalEnv = { ...process.env };

/** A purge that worked. */
function purged() {
  return { status: "purged", urls: 1, tags: 1, requests: 1, durationMs: 1 };
}

/** A purge that did not. */
function purgeFailed(error = "CDN purge responded 500") {
  return { status: "failed", urls: 1, tags: 1, requests: 1, durationMs: 1, error };
}

/** A step that never ran because its integration is not configured. */
function skipped(kind: "purge" | "revalidate") {
  return kind === "purge"
    ? { status: "skipped", urls: 0, tags: 0, requests: 0, durationMs: 0 }
    : { status: "skipped", tags: 0, paths: 0, durationMs: 0 };
}

/** A revalidation that worked. */
function revalidated() {
  return { status: "revalidated", tags: 1, paths: 6, durationMs: 5 };
}

/** A `Promise` whose resolution this test controls — for the coalescing tests. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Queue a branding save for the default agency. */
function queueBranding(overrides: Partial<Parameters<typeof queueRegeneration>[0]> = {}) {
  return queueRegeneration(
    { agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"], ...overrides },
    FAST,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRegenerationState();
  process.env.SITE_BASE_DOMAIN = "funtush.io";
  process.env.API_PUBLIC_URL = "https://api.funtush.com";
  cdnEnabled.mockReturnValue(true);
  rendererEnabled.mockReturnValue(true);
  purgeCdnMock.mockResolvedValue(purged());
  revalidateSiteMock.mockResolvedValue(revalidated());
});

afterEach(async () => {
  // Never leave a pipeline running into the next test — that is how a suite
  // develops a failure that only appears when the files run in a certain order.
  await flushRegenerations();
  resetRegenerationState();
  process.env = { ...originalEnv };
});

/* ── 1. Receipts ─────────────────────────────────────────────────────────── */

describe("createReceipt", () => {
  it("starts queued, with the targets already worked out", () => {
    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });

    expect(receipt.status).toBe("queued");
    expect(receipt.attempts).toBe(0);
    expect(receipt.targets.tags).toEqual(["branding:himalayan-trails"]);
    // Computed from the data, not from any CDN response — which is what lets a
    // developer with no CDN see exactly what a real deploy would purge.
    expect(receipt.targets.apiUrls).toEqual([
      "https://api.funtush.com/site/himalayan-trails/branding",
    ]);
  });

  it("accepts the saved row's Date as the version", () => {
    const updatedAt = new Date("2026-08-10T09:00:00.000Z");

    const receipt = createReceipt({
      agencyId: AGENCY_ID,
      slug: SLUG,
      scopes: ["branding"],
      version: updatedAt,
    });

    expect(receipt.version).toBe(updatedAt.getTime());
  });

  it("falls back to now when the caller has no row timestamp", () => {
    // A write path whose upsert result is not to hand should not have to invent
    // a version — "now" is still monotonic across saves, which is all the
    // renderer needs it to be.
    const before = Date.now();
    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });

    expect(receipt.version).toBeGreaterThanOrEqual(before);
  });

  it("de-duplicates repeated scopes", () => {
    const receipt = createReceipt({
      agencyId: AGENCY_ID,
      slug: SLUG,
      scopes: ["branding", "branding", "navigation"],
    });

    expect(receipt.scopes).toEqual(["branding", "navigation"]);
  });
});

/* ── 2. The pipeline — order is the whole feature ────────────────────────── */

describe("runRegeneration", () => {
  it("purges the API, then rebuilds, then purges the pages", async () => {
    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });

    await runRegeneration(receipt, FAST);

    const apiPurgeOrder = purgeCdnMock.mock.invocationCallOrder[0]!;
    const revalidateOrder = revalidateSiteMock.mock.invocationCallOrder[0]!;
    const sitePurgeOrder = purgeCdnMock.mock.invocationCallOrder[1]!;

    // Step 1 before step 2: otherwise the renderer rebuilds from the stale JSON
    // it can still read at the edge, and stamps a fresh timestamp on the wrong
    // content — the worst outcome available.
    expect(apiPurgeOrder).toBeLessThan(revalidateOrder);
    // Step 3 after step 2: otherwise the edge re-fetches the not-yet-rebuilt
    // page and re-caches the staleness it was just told to drop.
    expect(revalidateOrder).toBeLessThan(sitePurgeOrder);
  });

  it("purges the API reads by URL only, never by tag", async () => {
    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });

    await runRegeneration(receipt, FAST);

    const first = purgeCdnMock.mock.calls[0]![0] as { urls: string[]; tags?: string[] };

    expect(first.urls).toEqual(["https://api.funtush.com/site/himalayan-trails/branding"]);
    // The tags are also on the *page* responses. Purging them in step 1 would
    // drop the site's HTML before the rebuild — the exact ordering bug above,
    // reintroduced through the back door.
    expect(first.tags).toBeUndefined();
  });

  it("purges the pages by URL and tag together", async () => {
    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });

    await runRegeneration(receipt, FAST);

    const last = purgeCdnMock.mock.calls[1]![0] as { urls: string[]; tags: string[] };

    expect(last.tags).toEqual(["branding:himalayan-trails"]);
    // Tags cover the pages nobody can enumerate (every package detail page);
    // URLs cover the six we can name. Both, for the same reason the renderer
    // gets both.
    expect(last.urls).toContain("https://himalayan-trails.funtush.io/");
  });

  it("tells the renderer which version it is publishing", async () => {
    const receipt = createReceipt({
      agencyId: AGENCY_ID,
      slug: SLUG,
      scopes: ["branding"],
      version: 1_700_000_000_000,
    });

    await runRegeneration(receipt, FAST);

    expect(revalidateSiteMock.mock.calls[0]![0]).toMatchObject({
      slug: SLUG,
      version: 1_700_000_000_000,
      scopes: ["branding"],
    });
  });

  it("stops the pipeline when the API purge fails", async () => {
    purgeCdnMock.mockResolvedValue(purgeFailed());

    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });
    await runRegeneration(receipt, FAST);

    // Half of this sequence is worse than none of it: rebuilding now would bake
    // the stale JSON into fresh pages.
    expect(revalidateSiteMock).not.toHaveBeenCalled();
    expect(receipt.status).toBe("failed");
  });

  it("does not purge the pages when the rebuild failed", async () => {
    revalidateSiteMock.mockResolvedValue({
      status: "failed",
      tags: 1,
      paths: 6,
      durationMs: 3,
      error: "Renderer responded 500",
    });

    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });
    await runRegeneration(receipt, FAST);

    // Only the step-1 purge ran. Purging the pages now would evict a good cached
    // page and replace it with the same un-rebuilt one.
    expect(purgeCdnMock).toHaveBeenCalledTimes(MAX_REGENERATION_ATTEMPTS);
    expect(receipt.status).toBe("failed");
    expect(receipt.error).toContain("500");
  });

  it("retries and reports how many attempts it took", async () => {
    // Transient failure — a 502 from a control plane mid-deploy — then success.
    purgeCdnMock.mockResolvedValueOnce(purgeFailed()).mockResolvedValue(purged());

    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });
    await runRegeneration(receipt, FAST);

    expect(receipt.status).toBe("succeeded");
    expect(receipt.attempts).toBe(2);
    // The error from the failed attempt is cleared, not left behind to look like
    // a failure on a receipt that succeeded.
    expect(receipt.error).toBeUndefined();
  });

  it("gives up after three attempts rather than hammering a broken CDN", async () => {
    purgeCdnMock.mockResolvedValue(purgeFailed());

    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });
    await runRegeneration(receipt, FAST);

    expect(receipt.attempts).toBe(MAX_REGENERATION_ATTEMPTS);
    expect(receipt.status).toBe("failed");
    expect(receipt.completedAt).toBeDefined();
  });

  it("records each step's outcome as it happens, so a failure is diagnosable", async () => {
    revalidateSiteMock.mockResolvedValue({
      status: "failed",
      tags: 1,
      paths: 6,
      durationMs: 3,
      error: "Renderer responded 502",
    });

    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });
    await runRegeneration(receipt, FAST);

    // "The API purge worked and the renderer 502ed" is a different incident from
    // "the CDN token is wrong", and the difference is visible in one response.
    expect(receipt.steps.apiPurge?.status).toBe("purged");
    expect(receipt.steps.renderer?.status).toBe("failed");
    expect(receipt.steps.sitePurge).toBeUndefined();
  });

  it("reports 'skipped', not 'succeeded', when nothing is configured", async () => {
    // An unwired staging environment must not look healthy.
    purgeCdnMock.mockResolvedValue(skipped("purge"));
    revalidateSiteMock.mockResolvedValue(skipped("revalidate"));

    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });
    await runRegeneration(receipt, FAST);

    expect(receipt.status).toBe("skipped");
  });

  it("still succeeds when only one integration is configured", async () => {
    // A CDN and no renderer is a real deployment: static pages built at deploy
    // time, cache purged on save. The purge did work, so this is a success.
    revalidateSiteMock.mockResolvedValue(skipped("revalidate"));

    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });
    await runRegeneration(receipt, FAST);

    expect(receipt.status).toBe("succeeded");
  });

  it("survives a client that breaks its promise never to throw", async () => {
    purgeCdnMock.mockRejectedValue(new Error("boom"));

    const receipt = createReceipt({ agencyId: AGENCY_ID, slug: SLUG, scopes: ["branding"] });

    // No rejection reaches the caller. A background promise that rejects with
    // nobody awaiting it is how a Node process dies of a cache purge.
    await expect(runRegeneration(receipt, FAST)).resolves.toBe(receipt);
    expect(receipt.status).toBe("failed");
    expect(receipt.error).toBe("boom");
  });
});

/* ── 3. Queueing — the save must not wait, and must not fail ─────────────── */

describe("queueRegeneration", () => {
  it("returns without waiting for the pipeline to finish", async () => {
    // A purge that never answers. If `queueRegeneration` awaited anything, this
    // test would hang — which is precisely the guarantee being asserted:
    // whatever the CDN is doing, the agency's PATCH is as fast as it was on
    // Day 3.
    const gate = deferred<ReturnType<typeof purged>>();
    purgeCdnMock.mockReturnValueOnce(gate.promise).mockResolvedValue(purged());

    const receipt = queueBranding();

    // The first purge has been *started* — the save fires it immediately, not on
    // a timer — but nothing has been awaited, so the receipt is unfinished.
    expect(purgeCdnMock).toHaveBeenCalledTimes(1);
    expect(receipt.status).toBe("running");
    expect(receipt.completedAt).toBeUndefined();

    gate.resolve(purged());
    await flushRegenerations();

    expect(receipt.status).toBe("succeeded");
  });

  it("updates the same receipt object as the pipeline progresses", async () => {
    const receipt = queueBranding();
    expect(receipt.completedAt).toBeUndefined();

    await flushRegenerations();

    // One object, mutated in place — which is what makes the history endpoint
    // show a live status with no second copy to keep in step.
    expect(receipt.status).toBe("succeeded");
    expect(receipt.completedAt).toBeDefined();
  });

  it("does nothing at all for an empty scope list", async () => {
    const receipt = queueRegeneration({ agencyId: AGENCY_ID, slug: SLUG, scopes: [] }, FAST);
    await flushRegenerations();

    expect(receipt.status).toBe("skipped");
    expect(purgeCdnMock).not.toHaveBeenCalled();
  });

  it("records a failure on the receipt instead of throwing at the save", async () => {
    purgeCdnMock.mockResolvedValue(purgeFailed());

    const receipt = queueBranding();
    await flushRegenerations();

    // The row is committed and correct; the caches will catch up or a human
    // will press Republish. Either way the save was not a failure.
    expect(receipt.status).toBe("failed");
  });
});

/* ── 4. Coalescing ───────────────────────────────────────────────────────── */

describe("coalescing rapid saves", () => {
  it("runs one pipeline at a time per site", async () => {
    const gate = deferred<ReturnType<typeof purged>>();
    purgeCdnMock.mockReturnValueOnce(gate.promise).mockResolvedValue(purged());

    const first = queueBranding();
    const second = queueRegeneration(
      { agencyId: AGENCY_ID, slug: SLUG, scopes: ["navigation"] },
      FAST,
    );

    // The second save arrived while the first pipeline was stuck on its first
    // purge, so it is waiting rather than running alongside.
    expect(second.status).toBe("queued");
    expect(purgeCdnMock).toHaveBeenCalledTimes(1);

    gate.resolve(purged());
    await flushRegenerations();

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
  });

  it("folds a third save into the waiting one instead of queueing both", async () => {
    const gate = deferred<ReturnType<typeof purged>>();
    purgeCdnMock.mockReturnValueOnce(gate.promise).mockResolvedValue(purged());

    queueBranding();
    const waiting = queueRegeneration(
      { agencyId: AGENCY_ID, slug: SLUG, scopes: ["navigation"] },
      FAST,
    );
    const newest = queueRegeneration(
      { agencyId: AGENCY_ID, slug: SLUG, scopes: ["siteConfig"] },
      FAST,
    );

    gate.resolve(purged());
    await flushRegenerations();

    // The newer receipt survives — it carries the newer version, and publishing
    // an older version is how a renderer that de-duplicates ends up ignoring the
    // change entirely.
    expect(waiting.status).toBe("superseded");
    expect(waiting.supersededBy).toBe(newest.id);

    // Nothing is dropped: the superseded save's scope is regenerated too.
    expect(newest.scopes).toEqual(["navigation", "siteConfig"]);
    expect(newest.status).toBe("succeeded");
    expect(newest.targets.apiUrls).toEqual([
      "https://api.funtush.com/site/himalayan-trails/config",
      "https://api.funtush.com/site/himalayan-trails/navigation",
    ]);
  });

  it("keeps a mapped domain in the targets after coalescing", async () => {
    // The receipt carries `customDomain` precisely so the rebuilt targets after
    // a merge still cover both live caches.
    const gate = deferred<ReturnType<typeof purged>>();
    purgeCdnMock.mockReturnValueOnce(gate.promise).mockResolvedValue(purged());

    queueRegeneration(
      { agencyId: AGENCY_ID, slug: SLUG, customDomain: "everest.com", scopes: ["branding"] },
      FAST,
    );
    queueRegeneration(
      { agencyId: AGENCY_ID, slug: SLUG, customDomain: "everest.com", scopes: ["navigation"] },
      FAST,
    );
    const newest = queueRegeneration(
      { agencyId: AGENCY_ID, slug: SLUG, customDomain: "everest.com", scopes: ["siteConfig"] },
      FAST,
    );

    gate.resolve(purged());
    await flushRegenerations();

    expect(newest.targets.pageUrls).toContain("https://everest.com/");
    expect(newest.targets.pageUrls).toContain("https://himalayan-trails.funtush.io/");
  });

  it("does not make two different sites wait for each other", async () => {
    const gate = deferred<ReturnType<typeof purged>>();
    purgeCdnMock.mockReturnValueOnce(gate.promise).mockResolvedValue(purged());

    queueBranding();
    queueRegeneration(
      { agencyId: "agency-2", slug: "annapurna-base", scopes: ["branding"] },
      FAST,
    );

    // Coalescing is keyed by slug, not global. One agency's slow CDN response
    // must not delay every other agency's publish.
    expect(purgeCdnMock).toHaveBeenCalledTimes(2);

    gate.resolve(purged());
    await flushRegenerations();
  });
});

/* ── 5. History — the verification surface ───────────────────────────────── */

describe("history", () => {
  it("keeps receipts newest first, per agency", async () => {
    queueBranding();
    queueRegeneration({ agencyId: "agency-2", slug: "other-site", scopes: ["branding"] }, FAST);
    await flushRegenerations();

    const mine = getRegenerationHistory(AGENCY_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.slug).toBe(SLUG);

    // Tenant isolation (Backend Guide §4) holds here too: this is operational
    // data, but it is still one agency's operational data.
    expect(getRegenerationHistory("agency-2")[0]!.slug).toBe("other-site");
    expect(getRegenerationHistory("agency-3")).toEqual([]);
  });

  it("caps the list so a long-running worker cannot grow forever", async () => {
    for (let i = 0; i < REGENERATION_HISTORY_LIMIT + 5; i += 1) {
      queueBranding();
      await flushRegenerations();
    }

    expect(getRegenerationHistory(AGENCY_ID)).toHaveLength(REGENERATION_HISTORY_LIMIT);
  });

  it("honours a smaller requested limit", async () => {
    queueBranding();
    await flushRegenerations();
    queueBranding();
    await flushRegenerations();

    expect(getRegenerationHistory(AGENCY_ID, 1)).toHaveLength(1);
  });

  it("reports the newest receipt, or null for an agency that has never saved", async () => {
    expect(getLastRegeneration(AGENCY_ID)).toBeNull();

    const receipt: RegenerationReceipt = queueBranding();
    await flushRegenerations();

    expect(getLastRegeneration(AGENCY_ID)?.id).toBe(receipt.id);
  });
});

describe("getRegenerationCapabilities", () => {
  it("reports whether the platform is wired up at all", () => {
    expect(getRegenerationCapabilities()).toEqual({
      rendererConfigured: true,
      cdnConfigured: true,
    });

    // The answer to "why didn't my site update?" that does not require SSH
    // access to read an environment variable.
    cdnEnabled.mockReturnValue(false);
    rendererEnabled.mockReturnValue(false);

    expect(getRegenerationCapabilities()).toEqual({
      rendererConfigured: false,
      cdnConfigured: false,
    });
  });
});
