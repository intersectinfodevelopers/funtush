import "dotenv/config";

import { app } from "./app";
import { db, connectMongo } from "@funtush/database";
import {
  initNotificationService,
  ensureNotificationIndexes,
} from "./services/notificationDispatch.service";
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";
import { startVisibilityScoreCron } from "./jobs/visibilityScore.job";
import { startAdPerformanceSyncJob } from "./jobs/syncAdPerformance.job";
import { startExpireUnpaidBookingsCron } from "./jobs/expireUnpaidBookings.job";
import { configureIndexes } from "./services/search.service";
import { flushRegenerations } from "./services/regeneration.service";

const port = Number(process.env.PORT ?? 4000);

// `void db;` — keep the import referenced; the pooled client is created on import
// and shared by every service.
void db;

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  void (async () => {
    try {
      // Notification service needs the *Mongo* Db instance from the Mongoose
      // connection, not the Prisma client `db`.
      const mongoDb = await connectMongo();
      initNotificationService(mongoDb);
      await ensureNotificationIndexes();
    } catch (err) {
      console.error("Notification service init failed:", err);
    }
  })();

  startSubscriptionCron();
  startVisibilityScoreCron();
  startAdPerformanceSyncJob();
  startExpireUnpaidBookingsCron();

  // Ensure Meilisearch indexes + settings exist on boot (idempotent, non-blocking).
  configureIndexes().catch(console.error);

  const server = app.listen(port, () => {
    console.log(`Funtush API listening on port ${port}`);
  });

  /**
   * Graceful shutdown (White-label week · Day 4).
   *
   * A regeneration pipeline runs *after* the HTTP response has been sent, so a
   * deploy that kills the worker mid-pipeline can stop it between "the API cache
   * was purged" and "the pages were rebuilt". Draining first removes that window.
   */
  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal} received — draining regenerations`);
    server.close(() => {
      void flushRegenerations().finally(() => process.exit(0));
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export { app };
