/**
 * Ad platform adapters — Meta (Facebook) Marketing API + Google Ads API.
 *
 * These are STUBS so the admin queue works end-to-end in dev without live
 * credentials. They simulate pushing a creative live, pausing it, and reading
 * back delivery metrics. Swap the bodies for real SDK calls when you have keys:
 *   - Meta:   facebook-nodejs-business-sdk   (Marketing API)
 *   - Google: google-ads-api                 (Google Ads API)
 *
 * Lives alongside emailQueue.ts under src/lib/.
 */

import { randomUUID } from "crypto";

export interface CampaignCreative {
  imageUrls: string[];
  copyText: string;
  targetingParams: unknown;
}

export interface PlatformIds {
  metaCampaignId: string;
  googleCampaignId: string;
}

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  spend: number;
}

/**
 * Push a creative live on both Meta and Google. Returns the external campaign
 * IDs so we can pause / report on them later.
 */
export async function pushCampaignLive(
  creative: CampaignCreative
): Promise<PlatformIds> {
  // TODO: real Meta Marketing API call — create Campaign -> AdSet -> Ad
  // TODO: real Google Ads API call     — create Campaign -> AdGroup -> Ad
  void creative;
  return {
    metaCampaignId: `meta_${randomUUID()}`,
    googleCampaignId: `ggl_${randomUUID()}`,
  };
}

/**
 * Pause a live campaign on both platforms. Should be idempotent — pausing an
 * already-paused campaign must not throw.
 */
export async function pausePlatformCampaign(ids: PlatformIds): Promise<void> {
  // TODO: Meta   — POST /{campaign-id} { status: "PAUSED" }
  // TODO: Google — campaignOperations.update status = PAUSED
  void ids;
}

/**
 * Fetch fresh delivery metrics for a live campaign. In production this hits the
 * insights endpoints; here it returns zeros for the caller to merge in.
 */
export async function fetchCampaignMetrics(
  ids: PlatformIds
): Promise<CampaignMetrics> {
  // TODO: Meta   — GET /{campaign-id}/insights (impressions, clicks, spend)
  // TODO: Google — searchStream metrics.impressions, clicks, cost_micros
  void ids;
  return { impressions: 0, clicks: 0, spend: 0 };
}