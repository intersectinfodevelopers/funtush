import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the transactional-email trigger routes (API-wide
 * docs/test pass, Batch 5).
 *
 * Regression test for a real vulnerability: all 18 routes here had **no
 * auth middleware at all** — anyone could POST an arbitrary `to` address
 * plus most other template fields and have Funtush's own email
 * provider/identity send it, an open unauthenticated relay. Nothing in this
 * codebase calls these routes over HTTP (every real trigger calls
 * `emailService`'s functions directly, in-process), so `requireAdmin` was
 * added to gate the whole router — this file's every "without admin
 * context" test is the regression guard for that.
 */

const { adminState } = vi.hoisted(() => ({
  adminState: { allowed: false },
}));

vi.mock("../middleware/requireAdmin.middleware", () => ({
  requireAdmin: (
    _req: unknown,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!adminState.allowed) return res.status(403).json({ error: "Forbidden" });
    next();
  },
}));

const emailService = {
  sendInquiryReceived: vi.fn(),
  sendBookingConfirmed: vi.fn(),
  sendPaymentLink: vi.fn(),
  sendTrekReminder: vi.fn(),
  sendGuideContact: vi.fn(),
  sendReviewInvitation: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendKYCSubmittedEmail: vi.fn(),
  sendKYCApprovedEmail: vi.fn(),
  sendKYCRejectedEmail: vi.fn(),
  sendPaymentConfirmationEmail: vi.fn(),
  sendRenewalReminderEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
  sendBreakGlassInitiatedEmail: vi.fn(),
  sendBreakGlassClosedEmail: vi.fn(),
  sendBugStatusChangedEmail: vi.fn(),
  sendAdCampaignDecisionEmail: vi.fn(),
  sendSafetyWarningEmail: vi.fn(),
  sendTrekStartReminderEmail: vi.fn(),
};

vi.mock("../services/emailService", () => ({ emailService }));

let server: Server;
let baseUrl: string;

const ALL_PATHS = [
  "inquiry-received",
  "booking-confirmed",
  "payment-link",
  "trek-reminder",
  "guide-contact",
  "review-invitation",
  "welcome",
  "kyc-submitted",
  "kyc-approved",
  "kyc-rejected",
  "payment-confirmation",
  "renewal-reminder",
  "payment-failed",
  "breakglass-initiated",
  "breakglass-closed",
  "bug-status-changed",
  "ad-campaign-decision",
  "safety-warning",
  "trek-start-reminder",
];

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: emailRoutes } = await import("./emailRoutes");

  const app = express();
  app.use(express.json());
  app.use("/", emailRoutes);

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
  adminState.allowed = false;
  for (const fn of Object.values(emailService)) {
    fn.mockResolvedValue({ success: true, messageId: "mock-1" });
  }
});

describe("without the admin context — the vulnerability this file guards", () => {
  it.each(ALL_PATHS)("POST /%s is forbidden", async (path) => {
    const res = await fetch(`${baseUrl}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "someone@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("never calls the email service when forbidden", async () => {
    await fetch(`${baseUrl}/welcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "someone@example.com" }),
    });
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe("with the admin context", () => {
  beforeEach(() => {
    adminState.allowed = true;
  });

  it("POST /welcome sends and returns the service result", async () => {
    const res = await fetch(`${baseUrl}/welcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "jamie@example.com", firstName: "Jamie", verificationUrl: "https://x" }),
    });
    expect(res.status).toBe(200);
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
      "jamie@example.com",
      expect.objectContaining({ firstName: "Jamie" }),
    );
  });

  it("POST /booking-confirmed passes every template field through", async () => {
    const body = {
      to: "jamie@example.com",
      firstName: "Jamie",
      bookingId: "bk-1",
      trekName: "EBC",
      startDate: "2027-03-01",
      duration: "14 days",
      guide: "Pemba",
      itineraryPdfUrl: "https://x/pdf",
      dashboardUrl: "https://x/dash",
      totalPrice: 1500,
    };
    const res = await fetch(`${baseUrl}/booking-confirmed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const { to, ...rest } = body;
    expect(emailService.sendBookingConfirmed).toHaveBeenCalledWith(to, rest);
  });

  it("surfaces a service failure as 500", async () => {
    emailService.sendWelcomeEmail.mockRejectedValue(new Error("Provider unreachable"));
    const res = await fetch(`${baseUrl}/welcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "jamie@example.com" }),
    });
    expect(res.status).toBe(500);
  });
});
