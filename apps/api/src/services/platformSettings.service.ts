import { db } from "@funtush/database";

const SINGLETON_ID = "singleton";

/**
 * Platform-wide toggles a super-admin controls at runtime — as opposed to
 * env vars (need a redeploy) or per-agency settings (Agency/AgencySiteConfig/
 * etc). Always the same one row; created lazily on first read so a fresh
 * environment doesn't need a seed step.
 */
export async function getPlatformSettings() {
  return db.platformSettings.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
}

export async function updatePlatformSettings(
  patch: { agencyPhoneOtpRequired?: boolean },
  updatedBy: string,
) {
  return db.platformSettings.upsert({
    where: { id: SINGLETON_ID },
    update: { ...patch, updatedBy },
    create: { id: SINGLETON_ID, ...patch, updatedBy },
  });
}
