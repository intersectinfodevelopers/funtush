import { getFcm } from "../lib/fcm.js";
import { prisma } from "@funtush/database";

export interface PushPayload {
    title: string;
    body: string;
    data?: Record<string, string>;
}

//  Send a push notification to all agency admins who have an FCM token.
export async function notifyAgencyAdmins(
    agencyId: string,
    payload: PushPayload,
): Promise<void> {
    // Find all agency users with a stored FCM token
    const agencyUsers = await prisma.agencyUser.findMany({
        where: { agencyId },
        include: { user: true },
    });

    const tokens = agencyUsers
        .map((au: { user: { fcmToken: string | null } }) => au.user.fcmToken)
        .filter((t: string | null): t is string => !!t);

    if (tokens.length === 0) {
        console.warn(`[FCM] No FCM tokens found for agency ${agencyId}`);
        return;
    }

    const response = await getFcm().sendEachForMulticast({
        tokens,
        notification: {
            title: payload.title,
            body: payload.body,
        },
        data: payload.data ?? {},
        webpush: {
            notification: {
                title: payload.title,
                body: payload.body,
            },
            fcmOptions: {
                link: payload.data?.link,
            },
        },
    });

    const failed = response.responses.filter((r: { success: boolean }) => !r.success);
    if (failed.length > 0) {
        console.warn(`[FCM] ${failed.length} notification(s) failed for agency ${agencyId}`);
    }
}

