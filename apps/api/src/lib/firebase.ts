import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import type { Db } from "mongodb";

/**
 * Firebase Cloud Messaging integration (firebase-admin v14 modular API).
 *
 * Env vars required (add to apps/api/.env):
 *   FIREBASE_PROJECT_ID=funtush-xxxxx
 *   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@funtush-xxxxx.iam.gserviceaccount.com
 *   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *
 * (Values come from the service-account JSON in Firebase Console →
 *  Project settings → Service accounts → Generate new private key.)
 */

let app: App | null = null;

export function initFirebase(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // .env stores the key with literal \n — restore real newlines:
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase credentials missing: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
  }

  app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return app;
}

export interface SendPushResult {
  ok: boolean;
  successCount: number;
  failureCount: number;
  /** Tokens FCM reported as dead — already pruned from the DB by sendPush. */
  invalidTokens: string[];
  error?: string;
}

/**
 * Send a push notification to every registered device token of a user.
 *
 * Device tokens are read from the `device_tokens` collection:
 *   { user_id: string, token: string, platform: "android"|"ios"|"web", updated_at: Date }
 * (Registered by the mobile app via POST /users/me/device-token.)
 *
 * Dead tokens (unregistered / invalid) are pruned automatically.
 */
export async function sendPush(
  db: Db,
  userId: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
): Promise<SendPushResult> {
  const tokens = await db
    .collection("device_tokens")
    .find({ user_id: userId })
    .map((d) => d.token as string)
    .toArray();

  if (tokens.length === 0) {
    return { ok: false, successCount: 0, failureCount: 0, invalidTokens: [], error: "no_device_tokens" };
  }

  try {
    const messaging = getMessaging(initFirebase());
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });

    // Collect tokens FCM says are dead so we stop sending to them.
    const invalidTokens: string[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        invalidTokens.push(tokens[i]);
      }
    });
    if (invalidTokens.length > 0) {
      await db.collection("device_tokens").deleteMany({ token: { $in: invalidTokens } });
    }

    return {
      ok: res.successCount > 0,
      successCount: res.successCount,
      failureCount: res.failureCount,
      invalidTokens,
    };
  } catch (err) {
    return {
      ok: false,
      successCount: 0,
      failureCount: tokens.length,
      invalidTokens: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}