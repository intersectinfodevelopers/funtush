import cron from "node-cron";
import { recalculateAllVisibilityScores } from "../services/visibility.service";

export const startVisibilityScoreCron = () => {

    /** Every night at 2 AM */
    cron.schedule("0 2 * * *", async () => {
        try {

            await recalculateAllVisibilityScores();

            console.log("Visibility score recalculation job ran successfully");

        } catch (err) {
            console.log("Cron job failed:", err);
        }

    });
}