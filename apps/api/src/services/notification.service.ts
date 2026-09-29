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

// Send a push notification to a trekker by userId
export async function notifyTrekker(
    trekkerId: string,
    payload: PushPayload,
): Promise<void> {
    const trekker = await prisma.trekker.findUnique({
        where: { id: trekkerId },
        include: { user: true },
    });

    if (!trekker) {
        console.warn(`[FCM] Trekker ${trekkerId} not found`);
        return;
    }

    // In-app inbox first: it must exist even when there's no push token or FCM is down. Never blocks the push.
    try {
        await prisma.trekkerNotification.create({
            data: { trekkerId, title: payload.title.slice(0, 200), body: payload.body.slice(0, 1000), data: payload.data ?? undefined },
        });
    } catch (err) {
        console.error("[notifications] could not store trekker notification:", (err as Error).message);
    }

    const token = trekker.user.fcmToken;

    if (!token) {
        console.warn(`[FCM] No FCM token for trekker ${trekkerId}`);
        return;
    }

    const response = await getFcm().send({
        token,
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

    console.log(`[FCM] Trekker notification sent: ${response}`);
}