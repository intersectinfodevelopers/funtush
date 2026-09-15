import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the email-settings routes (backend catch-up pass).
 * Same shape as `notificationPreferences.routes.test.ts`. No public read to
 * test here — see `data/emailSettings.ts`.
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

const getEmailSettings = vi.fn();
const updateEmailSettings = vi.fn();

vi.mock("../services/emailSettings.service", () => ({
  getEmailSettings: (...a: unknown[]) => getEmailSettings(...a),
  updateEmailSettings: (...a: unknown[]) => updateEmailSettings(...a),
}));

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const SAVED_AT = new Date("2026-08-08T09:00:00.000Z");

const EDITABLE = {
  values: {
    senderName: "Himalayan Trails",
    fromAddress: "bookings@himalayantrails.com",
    replyTo: null,
    footerText: "Sent by your trekking agency via Funtush.",
    includeUnsubscribe: true,
    bccBookingsTo: null,
  },
  updatedAt: SAVED_AT,
};

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: emailSettingsRoutes } = await import("./emailSettings.routes");

  const app = express();
  app.use(express.json());
  app.use("/", emailSettingsRoutes);

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
  getEmailSettings.mockResolvedValue(EDITABLE);
  updateEmailSettings.mockResolvedValue(EDITABLE);
});

function patchJson(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/email-settings`, {
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
    expect((await fetch(`${baseUrl}/agencies/me/email-settings`)).status).toBe(401);
    expect((await patchJson({ senderName: "Trek Co" })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchJson({ senderName: "Trek Co" });
    expect(updateEmailSettings).not.toHaveBeenCalled();
  });

  it("passes the session's agency id to the service, never a body field", async () => {
    authState.agencyId = "agency-1";

    expect((await patchJson({ senderName: "Trek Co", agencyId: "other" }, "tok")).status).toBe(400);

    await patchJson({ senderName: "Trek Co" }, "tok");
    expect(updateEmailSettings).toHaveBeenCalledWith("agency-1", { senderName: "Trek Co" });
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/email-settings", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid body", async () => {
    const res = await patchJson({ senderName: "Trek Co" }, "tok");
    expect(res.status).toBe(200);

    const body = await readJson<{ success: boolean; message: string }>(res);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Email settings updated");
  });

  it("runs the status guard on the write", async () => {
    await patchJson({ senderName: "Trek Co" }, "tok");
    expect(statusGuardSpy).toHaveBeenCalledTimes(1);
  });

  it("does not run the status guard on the read", async () => {
    await fetch(`${baseUrl}/agencies/me/email-settings`, { headers: { "x-refresh-token": "tok" } });
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown key with 400 before the service is called", async () => {
    const res = await patchJson({ sendername: "Trek Co" }, "tok");

    expect(res.status).toBe(400);
    expect(updateEmailSettings).not.toHaveBeenCalled();
  });

  it("rejects a malformed from address with 400", async () => {
    const res = await patchJson({ fromAddress: "not-an-email" }, "tok");
    expect(res.status).toBe(400);
    expect(updateEmailSettings).not.toHaveBeenCalled();
  });

  it("rejects a malformed reply-to with 400", async () => {
    const res = await patchJson({ replyTo: "not-an-email" }, "tok");
    expect(res.status).toBe(400);
    expect(updateEmailSettings).not.toHaveBeenCalled();
  });

  it("rejects a malformed BCC address with 400", async () => {
    const res = await patchJson({ bccBookingsTo: "not-an-email" }, "tok");
    expect(res.status).toBe(400);
    expect(updateEmailSettings).not.toHaveBeenCalled();
  });

  it("rejects footer text containing < or > with 400", async () => {
    const res = await patchJson({ footerText: "<script>alert(1)</script>" }, "tok");
    expect(res.status).toBe(400);
    expect(updateEmailSettings).not.toHaveBeenCalled();
  });

  it("rejects a sender name over 80 characters with 400", async () => {
    const res = await patchJson({ senderName: "x".repeat(81) }, "tok");
    expect(res.status).toBe(400);
    expect(updateEmailSettings).not.toHaveBeenCalled();
  });

  it("accepts null to clear an address back to the platform default", async () => {
    await patchJson({ fromAddress: null }, "tok");
    expect(updateEmailSettings).toHaveBeenCalledWith("agency-1", { fromAddress: null });
  });

  it("trims before storing", async () => {
    await patchJson({ senderName: "  Trek Co  " }, "tok");
    expect(updateEmailSettings).toHaveBeenCalledWith("agency-1", { senderName: "Trek Co" });
  });

  it("accepts a partial patch to just one field", async () => {
    await patchJson({ includeUnsubscribe: false }, "tok");
    expect(updateEmailSettings).toHaveBeenCalledWith("agency-1", { includeUnsubscribe: false });
  });

  it("never caches a dashboard response", async () => {
    const res = await patchJson({ senderName: "Trek Co" }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── Dashboard reads ────────────────────────────────────────────────────── */

describe("GET /agencies/me/email-settings", () => {
  it("returns the saved values", async () => {
    authState.agencyId = "agency-1";

    const res = await fetch(`${baseUrl}/agencies/me/email-settings`, {
      headers: { "x-refresh-token": "tok" },
    });
    expect(res.status).toBe(200);

    const body = await readJson<{ data: typeof EDITABLE }>(res);
    expect(body.data.values.senderName).toBe("Himalayan Trails");
  });
});
