import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the notification-preferences routes (backend catch-up
 * pass). Same shape as `siteConfig.routes.test.ts`. There is no public read
 * to test here — see `data/notifications.ts` for why.
 */

const { authState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
}));

vi.mock("../middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.agencyId) return res.status(401).json({ message: "Refresh token is required" });
    req.agencyId = authState.agencyId;
    next();
  },
}));

const statusGuardSpy = vi.fn();

vi.mock("../middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (_req: unknown, _res: unknown, next: () => void) => {
    statusGuardSpy();
    next();
  },
}));

const getNotificationPreferences = vi.fn();
const getNotificationPreferenceOptions = vi.fn();
const updateNotificationPreferences = vi.fn();

vi.mock("../services/notificationPreferences.service", () => ({
  getNotificationPreferences: (...a: unknown[]) => getNotificationPreferences(...a),
  getNotificationPreferenceOptions: (...a: unknown[]) => getNotificationPreferenceOptions(...a),
  updateNotificationPreferences: (...a: unknown[]) => updateNotificationPreferences(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const SAVED_AT = new Date("2026-08-08T09:00:00.000Z");

const CHANNEL_DEFAULT = { email: false, inApp: true };

const EDITABLE = {
  preferences: {
    newInquiry: CHANNEL_DEFAULT,
    paymentReceived: CHANNEL_DEFAULT,
    bookingCancelled: CHANNEL_DEFAULT,
    newReview: CHANNEL_DEFAULT,
    sosTriggered: { email: true, inApp: true },
    lowSlots: CHANNEL_DEFAULT,
    subscription: CHANNEL_DEFAULT,
    weeklyDigest: CHANNEL_DEFAULT,
  },
  welcomeBackPopup: { enabled: true, message: "Welcome back! Ready to plan your next trek with us?" },
  updatedAt: SAVED_AT,
};

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: notificationPreferencesRoutes } = await import("./notificationPreferences.routes");

  const app = express();
  app.use(express.json());
  app.use("/", notificationPreferencesRoutes);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(() => {
  if (server) server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.agencyId = undefined;
  getNotificationPreferences.mockResolvedValue(EDITABLE);
  updateNotificationPreferences.mockResolvedValue(EDITABLE);
  getNotificationPreferenceOptions.mockResolvedValue({
    events: [{ id: "newInquiry", email: false, inApp: true, emailLocked: false }],
  });
});

function patchJson(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/notification-preferences`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-refresh-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

describe("auth on the dashboard endpoints", () => {
  it("401s the read and the write without a token", async () => {
    expect((await fetch(`${baseUrl}/agencies/me/notification-preferences`)).status).toBe(401);
    expect((await patchJson({ welcomeBackPopupEnabled: false })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchJson({ welcomeBackPopupEnabled: false });
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("passes the session's agency id to the service, never a body field", async () => {
    authState.agencyId = "agency-1";

    expect(
      (await patchJson({ welcomeBackPopupEnabled: false, agencyId: "other" }, "tok")).status,
    ).toBe(400);

    await patchJson({ welcomeBackPopupEnabled: false }, "tok");
    expect(updateNotificationPreferences).toHaveBeenCalledWith("agency-1", { welcomeBackPopupEnabled: false });
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/notification-preferences", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid body", async () => {
    const res = await patchJson({ preferences: { newInquiry: { email: true } } }, "tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ success: boolean; message: string }>(res);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Notification preferences updated");
  });

  it("runs the status guard on the write", async () => {
    await patchJson({ welcomeBackPopupEnabled: false }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("does not run the status guard on the reads", async () => {
    await fetch(`${baseUrl}/agencies/me/notification-preferences`, { headers: { "x-refresh-token": "tok" } });
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown top-level key with 400 before the service is called", async () => {
    const res = await patchJson({ welcomBackPopupEnabled: false }, "tok");

    expect(res.status).toBe(400);
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("rejects an unknown event key inside preferences with 400", async () => {
    const res = await patchJson({ preferences: { madeUpEvent: { email: true } } }, "tok");

    expect(res.status).toBe(400);
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("rejects an unknown channel key inside one event with 400", async () => {
    const res = await patchJson({ preferences: { newInquiry: { sms: true } } }, "tok");

    expect(res.status).toBe(400);
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("accepts a partial patch to just one event's one channel", async () => {
    await patchJson({ preferences: { lowSlots: { email: true } } }, "tok");
    expect(updateNotificationPreferences).toHaveBeenCalledWith("agency-1", {
      preferences: { lowSlots: { email: true } },
    });
  });

  it("rejects a welcome-back message over 140 characters with 400", async () => {
    const res = await patchJson({ welcomeBackPopupMessage: "x".repeat(141) }, "tok");
    expect(res.status).toBe(400);
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("rejects a welcome-back message containing < or > with 400", async () => {
    const res = await patchJson({ welcomeBackPopupMessage: "<script>alert(1)</script>" }, "tok");
    expect(res.status).toBe(400);
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("accepts null to clear the welcome-back message back to the platform default", async () => {
    await patchJson({ welcomeBackPopupMessage: null }, "tok");
    expect(updateNotificationPreferences).toHaveBeenCalledWith("agency-1", { welcomeBackPopupMessage: null });
  });

  it("surfaces a 400 the service throws (the welcome-back coherence rule)", async () => {
    updateNotificationPreferences.mockRejectedValue(
      Object.assign(new Error("Add a popup message before turning the welcome-back popup on."), {
        status: 400,
      }),
    );

    const res = await patchJson({ welcomeBackPopupEnabled: true }, "tok");
    expect(res.status).toBe(400);

    const body = await readJson<{ message: string }>(res);
    expect(body.message).toContain("welcome-back popup");
  });

  it("never caches a dashboard response", async () => {
    const res = await patchJson({ welcomeBackPopupEnabled: false }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── Dashboard reads ────────────────────────────────────────────────────── */

describe("GET /agencies/me/notification-preferences", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("returns the preferences, with SOS email always true", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/notification-preferences`, {
      headers: { "x-refresh-token": "tok" },
    });
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof EDITABLE }>(res);
    expect(body.data.preferences.sosTriggered.email).toBe(true);
  });

  it("serves the options from a separate path", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/notification-preferences/options`, {
      headers: { "x-refresh-token": "tok" },
    });

    expect(res.status).toBe(200);
    expect(getNotificationPreferenceOptions).toHaveBeenCalledWith("agency-1");
    expect(getNotificationPreferences).not.toHaveBeenCalled();
  });
});
