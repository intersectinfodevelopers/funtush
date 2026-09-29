import cron from "node-cron";
import { db } from "@funtush/database";
import { acquireJobLock } from "./jobLock";

export const startPublishScheduledBlogsCron = () => {

    /** Every 5 minutes — a SCHEDULED post whose publish time has passed goes live. publishAt is kept
     * (not cleared) afterwards, as a record of when it was scheduled for. */
    cron.schedule("*/5 * * * *", async () => {
        if (!(await acquireJobLock("publish-scheduled-blogs", 120))) return; // another process owns this tick

        try {
            const { count } = await db.blog.updateMany({
                where: { status: "SCHEDULED", publishAt: { lte: new Date() } },
                data: { status: "PUBLISHED" },
            });
            if (count > 0) console.log(`Published ${count} scheduled blog post(s)`);
        } catch (err) {
            console.log("Cron job failed:", err);
        }

    });
}
