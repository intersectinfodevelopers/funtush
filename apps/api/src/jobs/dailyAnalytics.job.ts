import { upsertDailySummary } from "../services/analytics.service";
import { getAnalyticsCollection } from "../models/analyticsEvent.model";

/**
 * Runs nightly to rebuild DailyAgencySummary for all active agencies.
 * Scheduled via node-cron: "0 2 * * *" (2 AM every night).
 */
export async function runDailyAnalyticsJob(): Promise<void> {
  console.log("[DailyAnalyticsJob] Starting nightly summary rebuild...");
  const started = Date.now();

  try {
    const events = await getAnalyticsCollection();

    // Get yesterday's date string
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    // Find all distinct agency_ids with events yesterday
    const agencyIds = await events.distinct("agency_id", {
      timestamp: {
        $gte: new Date(`${dateStr}T00:00:00.000Z`),
        $lte: new Date(`${dateStr}T23:59:59.999Z`),
      },
    });

    console.log(`[DailyAnalyticsJob] Rebuilding summaries for ${agencyIds.length} agencies on ${dateStr}`);

    // Upsert summaries in parallel (batched to avoid overwhelming MongoDB)
    const BATCH_SIZE = 10;
    for (let i = 0; i < agencyIds.length; i += BATCH_SIZE) {
      const batch = agencyIds.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((id) => upsertDailySummary(id, dateStr)));
    }

    const duration = Date.now() - started;
    console.log(`[DailyAnalyticsJob] Completed in ${duration}ms — ${agencyIds.length} summaries updated`);
  } catch (err) {
    console.error("[DailyAnalyticsJob] Failed:", err);
  }
}

/**
 * Starts the nightly cron job.
 * Import and call once from your app entry point.
 */
export function startDailyAnalyticsCron(): void {
  // Dynamic import of node-cron to avoid breaking tests
  import("node-cron").then(({ default: cron }) => {
    cron.schedule("0 2 * * *", () => {
      runDailyAnalyticsJob();
    });
    console.log("[DailyAnalyticsJob] Cron scheduled — runs at 2 AM nightly");
  }).catch((err) => {
    console.error("[DailyAnalyticsJob] Failed to start cron:", err);
  });
}
