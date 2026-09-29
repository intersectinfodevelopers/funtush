import cron from "node-cron";
import { recalculateAllVisibilityScores } from "../services/visibility.service";
import { acquireJobLock } from "./jobLock";

export const startVisibilityScoreCron = () => {

    /** Every night at 2 AM */
    cron.schedule("0 2 * * *", async () => {
        if (!(await acquireJobLock("visibility-score", 600))) return; // another process owns this tick

        try {

            await recalculateAllVisibilityScores();

            console.log("Visibility score recalculation job ran successfully");

        } catch (err) {
            console.log("Cron job failed:", err);
        }

    });
}