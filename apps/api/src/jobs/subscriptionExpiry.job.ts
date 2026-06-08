import cron from "node-cron";
import { lockExpiredAgencies } from "../services/agency.service.js";


export const startSubscriptionCron = () => {

    // cron.schedule("* * * * *", async () => { // For testing
    cron.schedule("0 0 * * *", async () => {
        try {

            await lockExpiredAgencies();

            console.log("Subscription expiry job ran successfully");

        } catch (err) {
            console.log("Cron job failed:", err);
        }

    });
}