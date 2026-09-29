import cron from "node-cron";
import { archiveCompletedPackages } from "../services/package.service";
import { releaseIdleGuides } from "../services/guideAvailability.service";
import { acquireJobLock } from "./jobLock";

/** Hourly (and once at start-up): archive packages whose single departure date has passed. */
export const startArchiveCompletedPackagesCron = () => {
  const run = async () => {
    if (!(await acquireJobLock("archive-completed-packages", 300))) return; // another process owns this tick
    try {
      const n = await archiveCompletedPackages();
      if (n > 0) console.log(`[archive completed] ${n} package(s) archived`);
      await releaseIdleGuides(); // guides whose treks have ended are Available again
    } catch (err) {
      console.error("Archive-completed-packages job failed:", err);
    }
  };
  cron.schedule("10 * * * *", run);
  void run();
};
