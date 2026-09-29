import cron from "node-cron";
import { lockExpiredAgencies } from "../services/agency.service";
import { acquireJobLock } from "./jobLock";


export const startSubscriptionCron = () => {

    // cron.schedule("* * * * *", async () => { // For testing
    cron.schedule("0 0 * * *", async () => {
        if (!(await acquireJobLock("subscription-expiry", 600))) return; // another process owns this tick

        try {

            await lockExpiredAgencies();

            console.log("Subscription expiry job ran successfully");

        } catch (err) {
            console.log("Cron job failed:", err);
        }

    });
}