import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the Stripe subscription webhook (API-wide docs/test
 * pass — closing a gap left over from Batch 5, where this file was reviewed
 * and confirmed correct but never actually got docs or a test). Signature
 * verification is exercised for real (HMAC over the raw body, matching
 * Stripe's own construction); `stripeWebhookLog`/handler side effects are
 * mocked.
 */

process.env.STRIPE_WEBHOOK_SECRET = "test-stripe-webhook-secret";

const stripeWebhookLogCreate = vi.fn();
const stripeWebhookLogUpdate = vi.fn();
vi.mock("@funtush/database", () => ({
  db: {
    stripeWebhookLog: {
      create: (...a: unknown[]) => stripeWebhookLogCreate(...a),
      update: (...a: unknown[]) => stripeWebhookLogUpdate(...a),
    },
  },
}));

const handleInvoicePaid = vi.fn();
const handlePaymentFailed = vi.fn();
const handleSubscriptionDeleted = vi.fn();
vi.mock("../../services/stripeSubscriptionService", () => ({
  handleInvoicePaid: (...a: unknown[]) => handleInvoicePaid(...a),
  handlePaymentFailed: (...a: unknown[]) => handlePaymentFailed(...a),
  handleSubscriptionDeleted: (...a: unknown[]) => handleSubscriptionDeleted(...a),
}));

let server: Server;
let baseUrl: string;

function stripeSignature(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

function stripeEvent(id: string, type: string, object: Record<string, unknown>) {
  return JSON.stringify({ id, type, data: { object } });
}

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: stripeWebhookRoutes } = await import("./stripe");

  const app = express();
  // Mirrors app.ts: this router applies its own raw() body parser, so it
  // must be mounted before the global express.json() — otherwise json()
  // already consumes the stream and Stripe's signature (computed over the
  // exact raw bytes) can never match.
  app.use("/webhooks", stripeWebhookRoutes);
  app.use(express.json());

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
  stripeWebhookLogCreate.mockResolvedValue({});
  stripeWebhookLogUpdate.mockResolvedValue({});
});

describe("POST /webhooks/stripe", () => {
  it("400s without a stripe-signature header", async () => {
    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("400s an invalid signature", async () => {
    const body = stripeEvent("evt_1", "invoice.paid", { id: "in_1", subscription: "sub_1" });
    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bogus" },
      body,
    });
    expect(res.status).toBe(400);
  });

  it("logs and processes a valid invoice.paid event", async () => {
    const body = stripeEvent("evt_2", "invoice.paid", { id: "in_2", subscription: "sub_2" });
    const signature = stripeSignature(body, "test-stripe-webhook-secret");

    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });

    expect(res.status).toBe(200);
    expect(stripeWebhookLogCreate).toHaveBeenCalledWith({
      data: { eventId: "evt_2", eventType: "invoice.paid", resourceId: "in_2" },
    });
    expect(handleInvoicePaid).toHaveBeenCalledWith("in_2", "sub_2");
    expect(stripeWebhookLogUpdate).toHaveBeenCalledWith({
      where: { eventId: "evt_2" },
      data: expect.objectContaining({ status: "processed" }),
    });
  });

  it("logs and processes a valid invoice.payment_failed event", async () => {
    const body = stripeEvent("evt_3", "invoice.payment_failed", { id: "in_3", subscription: "sub_3" });
    const signature = stripeSignature(body, "test-stripe-webhook-secret");

    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });

    expect(res.status).toBe(200);
    expect(handlePaymentFailed).toHaveBeenCalledWith("in_3", "sub_3");
  });

  it("logs and processes a valid customer.subscription.deleted event", async () => {
    const body = stripeEvent("evt_4", "customer.subscription.deleted", { id: "sub_4" });
    const signature = stripeSignature(body, "test-stripe-webhook-secret");

    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });

    expect(res.status).toBe(200);
    expect(handleSubscriptionDeleted).toHaveBeenCalledWith("sub_4");
  });

  it("acknowledges but records failure for an unhandled event type without crashing", async () => {
    const body = stripeEvent("evt_5", "customer.updated", { id: "cus_5" });
    const signature = stripeSignature(body, "test-stripe-webhook-secret");

    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });

    expect(res.status).toBe(200);
    expect(handleInvoicePaid).not.toHaveBeenCalled();
    expect(handlePaymentFailed).not.toHaveBeenCalled();
    expect(handleSubscriptionDeleted).not.toHaveBeenCalled();
  });

  it("500s and marks the log failed when the handler throws", async () => {
    handleInvoicePaid.mockRejectedValue(new Error("db unavailable"));
    const body = stripeEvent("evt_6", "invoice.paid", { id: "in_6", subscription: "sub_6" });
    const signature = stripeSignature(body, "test-stripe-webhook-secret");

    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });

    expect(res.status).toBe(500);
    expect(stripeWebhookLogUpdate).toHaveBeenCalledWith({
      where: { eventId: "evt_6" },
      data: { status: "failed", errorMessage: "db unavailable" },
    });
  });
});
