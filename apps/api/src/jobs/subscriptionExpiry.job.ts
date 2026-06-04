import cron from "node-cron";
import { lockExpiredAgencies } from "../services/agency.service";


export const startSubscriptionCron = () => {

    // cron.schedule("* * * * *", async () => { // For testing
    cron.schedule("0 0 * * *", async () => {
        try {

            await lockExpiredAgencies();

            return {
                success: true,
                message: "Subscription expiry job ran successfully"
            };

        } catch (error: any) {
            throw new Error("Cron job failed:", error.message);
        }

    });
}