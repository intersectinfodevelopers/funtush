import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the payment provider webhooks (API-wide docs/test
 * pass, Batch 5) — previously zero coverage of any kind. Signature
 * verification is exercised for real (Stripe HMAC, eSewa/ConnectIPS HMAC);
 * `verifyKhaltiPayment` (a real outbound call to Khalti's API) and
 * `processConfirmedPayment` are mocked.
 */

process.env.STRIPE_WEBHOOK_SECRET = "test-stripe-secret";
process.env.ESEWA_SECRET_KEY = "test-esewa-secret";
process.env.CONNECTIPS_SECRET_KEY = "test-connectips-secret";
process.env.CONNECTIPS_MERCHANT_ID = "MERCHANT1";
process.env.CONNECTIPS_APP_ID = "APP1";
process.env.CONNECTIPS_APP_NAME = "FuntushTest";

const verifyKhaltiPayment = vi.fn();
vi.mock("../lib/verifySignature", async () => {
  const actual = await vi.importActual<typeof import("../lib/verifySignature")>("../lib/verifySignature");
  return { ...actual, verifyKhaltiPayment: (...a: unknown[]) => verifyKhaltiPayment(...a) };
});

const processConfirmedPayment = vi.fn();
vi.mock("../services/payment.service", () => ({
  processConfirmedPayment: (...a: unknown[]) => processConfirmedPayment(...a),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: paymentWebhookRoutes } = await import("./payment.webhook.routes");

  const app = express();
  // Mirrors app.ts exactly: this router (whose Stripe route applies its own
  // raw() before anything JSON-parses the stream) must be mounted before
  // the global express.json() — otherwise json() already consumes the
  // body and Stripe's signature (computed over the exact raw bytes) can
  // never match.
  app.use("/", paymentWebhookRoutes);
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
  processConfirmedPayment.mockResolvedValue(undefined);
});

function stripeSignature(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

describe("POST /:agencyId/stripe", () => {
  it("400s without a stripe-signature header", async () => {
    const res = await fetch(`${baseUrl}/agency-1/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("400s an invalid signature", async () => {
    const res = await fetch(`${baseUrl}/agency-1/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=wrong" },
      body: JSON.stringify({ type: "payment_intent.succeeded", data: { object: {} } }),
    });
    expect(res.status).toBe(400);
  });

  it("processes a validly signed payment_intent.succeeded event", async () => {
    const body = JSON.stringify({
      type: "payment_intent.succeeded",
      data: { object: { metadata: { bookingId: "bk-1", agencyId: "agency-1" }, amount_received: 150000 } },
    });
    const signature = stripeSignature(body, "test-stripe-secret");

    const res = await fetch(`${baseUrl}/agency-1/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });
    expect(res.status).toBe(200);
    expect(processConfirmedPayment).toHaveBeenCalledWith("bk-1", "agency-1", 1500);
  });

  it("ignores an event type other than payment_intent.succeeded, without calling processConfirmedPayment", async () => {
    const body = JSON.stringify({ type: "charge.refunded", data: { object: {} } });
    const signature = stripeSignature(body, "test-stripe-secret");

    const res = await fetch(`${baseUrl}/agency-1/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });
    expect(res.status).toBe(200);
    expect(processConfirmedPayment).not.toHaveBeenCalled();
  });

  it("400s when the metadata's agencyId doesn't match the URL's agencyId", async () => {
    const body = JSON.stringify({
      type: "payment_intent.succeeded",
      data: { object: { metadata: { bookingId: "bk-1", agencyId: "other-agency" }, amount_received: 100 } },
    });
    const signature = stripeSignature(body, "test-stripe-secret");

    const res = await fetch(`${baseUrl}/agency-1/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body,
    });
    expect(res.status).toBe(400);
    expect(processConfirmedPayment).not.toHaveBeenCalled();
  });
});

describe("POST /:agencyId/khalti", () => {
  it("requires pidx and purchase_order_id", async () => {
    const res = await fetch(`${baseUrl}/agency-1/khalti`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("400s when Khalti's own lookup rejects the payment", async () => {
    verifyKhaltiPayment.mockResolvedValue(null);
    const res = await fetch(`${baseUrl}/agency-1/khalti`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pidx: "pidx-1", purchase_order_id: "bk-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("processes a payment Khalti's own lookup confirms", async () => {
    verifyKhaltiPayment.mockResolvedValue({ amount: 1500, transactionId: "txn-1" });
    const res = await fetch(`${baseUrl}/agency-1/khalti`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pidx: "pidx-1", purchase_order_id: "bk-1" }),
    });
    expect(res.status).toBe(200);
    expect(processConfirmedPayment).toHaveBeenCalledWith("bk-1", "agency-1", 1500);
  });
});

describe("POST /:agencyId/esewa", () => {
  function esewaPayload(overrides: Record<string, string> = {}) {
    const payload = {
      transaction_code: "txn-1",
      status: "COMPLETE",
      total_amount: "1,500.00",
      transaction_uuid: "bk-1",
      product_code: "EPAYTEST",
      signed_field_names: "total_amount,transaction_uuid,product_code",
      ...overrides,
    };
    const message = payload.signed_field_names
      .split(",")
      .map((f) => `${f}=${payload[f as keyof typeof payload]}`)
      .join(",");
    const signature = crypto.createHmac("sha256", "test-esewa-secret").update(message).digest("base64");
    return { ...payload, signature };
  }

  it("400s missing data payload", async () => {
    const res = await fetch(`${baseUrl}/agency-1/esewa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("ignores a non-COMPLETE status without processing payment", async () => {
    const payload = esewaPayload({ status: "PENDING" });
    const data = Buffer.from(JSON.stringify(payload)).toString("base64");
    const res = await fetch(`${baseUrl}/agency-1/esewa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });
    expect(res.status).toBe(200);
    expect(processConfirmedPayment).not.toHaveBeenCalled();
  });

  it("400s an invalid signature", async () => {
    const payload = { ...esewaPayload(), signature: "tampered" };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64");
    const res = await fetch(`${baseUrl}/agency-1/esewa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });
    expect(res.status).toBe(400);
  });

  it("processes a validly signed COMPLETE payment", async () => {
    const payload = esewaPayload();
    const data = Buffer.from(JSON.stringify(payload)).toString("base64");
    const res = await fetch(`${baseUrl}/agency-1/esewa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });
    expect(res.status).toBe(200);
    expect(processConfirmedPayment).toHaveBeenCalledWith("bk-1", "agency-1", 1500);
  });
});

describe("POST /:agencyId/connectips", () => {
  it("ignores a non-SUCCESS status without processing payment", async () => {
    const res = await fetch(`${baseUrl}/agency-1/connectips`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ STATUS: "FAILED", TXNAMT: "100", REFERENCEID: "bk-1", TXNID: "t1", TOKEN: "x" }),
    });
    expect(res.status).toBe(200);
    expect(processConfirmedPayment).not.toHaveBeenCalled();
  });

  it("400s an invalid signature/token", async () => {
    const res = await fetch(`${baseUrl}/agency-1/connectips`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ STATUS: "SUCCESS", TXNAMT: "150000", REFERENCEID: "bk-1", TXNID: "t1", TOKEN: "wrong" }),
    });
    expect(res.status).toBe(400);
    expect(processConfirmedPayment).not.toHaveBeenCalled();
  });
});
