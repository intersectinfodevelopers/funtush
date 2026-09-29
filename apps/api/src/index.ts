import "dotenv/config";

import { assertSecureConfig } from "./lib/assertSecureConfig";
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
import { startArchiveCompletedPackagesCron } from "./jobs/archiveCompletedPackages.job";
import { startPublishScheduledBlogsCron } from "./jobs/publishScheduledBlogs.job";
import { configureIndexes } from "./services/search.service";
import { flushRegenerations } from "./services/regeneration.service";
import { flushRequestLogs } from "./services/logger.service";
import { redis } from "./lib/redis";

assertSecureConfig(); // no-op outside production

const port = Number(process.env.PORT ?? 4000);

// `void db;` — keep the import referenced; the pooled client is created on import
// and shared by every service.
void db;

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  // lib/redis is lazyConnect with the offline queue off, so until something
  // connects it every command fails ("Stream isn't writeable") — the first
  // request that touched Redis after boot (rate limits, OTP, password reset)
  // used to take that hit. Connect at startup instead.
  if (redis.status === "wait") redis.connect().catch((err) => console.error("[Redis] initial connect failed:", err.message));

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
  startArchiveCompletedPackagesCron();
  startPublishScheduledBlogsCron();

  // Ensure Meilisearch indexes + settings exist on boot (idempotent, non-blocking).
  configureIndexes().catch(console.error);

  const server = app.listen(port, () => {
    console.log(`Funtush API listening on port ${port}`);
  });

  // Socket-level timeouts. Node's defaults let a client hold a connection open
  // indefinitely (slowloris) and keep-alive sockets close *before* a typical
  // proxy's own idle timeout, producing intermittent 502s.
  server.requestTimeout = 60_000;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 65_000; // > nginx's 60s upstream keep-alive

  // Since Node 15 an unhandled promise rejection terminates the process — one
  // forgotten `await`/`.catch` in any of ~320 routes would take down every
  // in-flight request. Log and carry on. A true uncaught exception leaves the
  // process in an unknown state, so drain and exit for the supervisor
  // (docker `restart:`, pm2, k8s) to bring up a clean one.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
    shutdown("uncaughtException", 1);
  });

  /**
   * Graceful shutdown (White-label week · Day 4).
   *
   * A regeneration pipeline runs *after* the HTTP response has been sent, so a
   * deploy that kills the worker mid-pipeline can stop it between "the API cache
   * was purged" and "the pages were rebuilt". Draining first removes that window.
   */
  let shuttingDown = false;
  const shutdown = (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — draining`);

    // server.close() waits for keep-alive sockets, which can be forever.
    const force = setTimeout(() => {
      console.error("[shutdown] drain timed out — forcing exit");
      process.exit(exitCode || 1);
    }, 15_000);
    force.unref();

    server.close(() => {
      void Promise.allSettled([flushRegenerations(), flushRequestLogs()]).finally(() => process.exit(exitCode));
    });
    server.closeIdleConnections?.();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export { app };
