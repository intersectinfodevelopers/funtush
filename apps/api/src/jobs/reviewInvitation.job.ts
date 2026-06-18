import cron from "node-cron";
import { sendReviewInvitations } from "src/services/review.service";


export const startSubscriptionCron = () => {

    /**Every midnight */
    cron.schedule("0 0 * * *", async () => { 
        try {

            await sendReviewInvitations();
            
            console.log(" Review Invitation cron ran successfully");

        } catch (err) {
            console.log("Cron job failed:", err);
        }

    });
}