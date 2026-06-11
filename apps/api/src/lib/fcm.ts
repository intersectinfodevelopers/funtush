import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

export const getFcm = () => {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FCM_PROJECT_ID!,
        clientEmail: process.env.FCM_CLIENT_EMAIL!,
        privateKey:  process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return getMessaging();
};