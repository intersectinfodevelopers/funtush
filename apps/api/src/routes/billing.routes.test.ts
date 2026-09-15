import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the billing / subscription-payment routes (API-wide
 * docs/test pass, Batch 6). All routes except `/fonepay/verify` require a
 * real agency session (`authenticateWithRefreshToken` + `checkAgencyStatus`);
 * `/fonepay/verify` is deliberately unauthenticated — it's verified
 * server-side against the real Fonepay API before anything is credited,
 * the same trust model as the payment webhooks.
 */

const { authState } = vi.hoisted(() => ({ authState: { valid: false, active: true } }));

vi.mock("src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.valid) return res.status(401).json({ error: "Unauthorized" });
    req.agencyId = "agency-1";
    next();
  },
}));

vi.mock("src/middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.active) return res.status(403).json({ error: "inactive" });
    next();
  },
}));

const findUniqueAgency = vi.fn();
vi.mock("@funtush/database", () => ({
  db: {
    agency: { findUnique: (...a: unknown[]) => findUniqueAgency(...a) },
    nepaliPaymentVerification: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const createStripeSubscription = vi.fn();
vi.mock("../services/stripeSubscriptionService", () => ({
  createStripeSubscription: (...a: unknown[]) => createStripeSubscription(...a),
}));

const initiateKhaltiPayment = vi.fn();
const verifyAndCompleteKhaltiPayment = vi.fn();
vi.mock("../services/khaltiSubscriptionService", () => ({
  initiateKhaltiPayment: (...a: unknown[]) => initiateKhaltiPayment(...a),
  verifyAndCompleteKhaltiPayment: (...a: unknown[]) => verifyAndCompleteKhaltiPayment(...a),
}));

const initiateEsewaPayment = vi.fn();
const verifyAndCompleteEsewaPayment = vi.fn();
vi.mock("../services/esewaSubscriptionService", () => ({
  initiateEsewaPayment: (...a: unknown[]) => initiateEsewaPayment(...a),
  verifyAndCompleteEsewaPayment: (...a: unknown[]) => verifyAndCompleteEsewaPayment(...a),
}));

const initiateConnectIPSPayment = vi.fn();
const checkAndUpdateConnectIPSPayment = vi.fn();
vi.mock("../services/connectIPSService", () => ({
  initiateConnectIPSPayment: (...a: unknown[]) => initiateConnectIPSPayment(...a),
  checkAndUpdateConnectIPSPayment: (...a: unknown[]) => checkAndUpdateConnectIPSPayment(...a),
}));

const activateFonepay = vi.fn();
const generateDynamicQR = vi.fn();
const getFonepayStatus = vi.fn();
const processAndVerifyFonepayTransaction = vi.fn();
vi.mock("../services/fonepayService", () => ({
  activateFonepay: (...a: unknown[]) => activateFonepay(...a),
  generateDynamicQR: (...a: unknown[]) => generateDynamicQR(...a),
  getFonepayStatus: (...a: unknown[]) => getFonepayStatus(...a),
  processAndVerifyFonepayTransaction: (...a: unknown[]) => processAndVerifyFonepayTransaction(...a),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: billingRoutes } = await import("./billing.routes");

  const app = express();
  app.use(express.json());
  app.use("/", billingRoutes);

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
  authState.valid = false;
  authState.active = true;
  findUniqueAgency.mockResolvedValue({ id: "agency-1", email: "agency@example.com" });
});

async function post(path: string, body: unknown, opts: { auth?: boolean } = { auth: true }) {
  if (opts.auth !== false) authState.valid = true;
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("auth gate", () => {
  it("401s every authenticated route without a session", async () => {
    const routes = [
      "/subscribe",
      "/subscribe/verify",
      "/subscribe/khalti/initiate",
      "/subscribe/esewa/initiate",
      "/subscribe/connectips/initiate",
      "/fonepay/activate",
      "/fonepay/qr/dynamic",
    ];
    for (const r of routes) {
      const res = await post(r, {}, { auth: false });
      expect(res.status).toBe(401);
    }
  });

  it("403s when the agency's subscription is inactive", async () => {
    authState.active = false;
    const res = await post("/subscribe", { subscriptionTierId: "tier-1" });
    expect(res.status).toBe(403);
  });
});

describe("POST /subscribe", () => {
  it("creates a Stripe subscription for the authenticated agency", async () => {
    createStripeSubscription.mockResolvedValue({
      subscription: { id: "sub_123" },
      clientSecret: "secret_abc",
    });
    const res = await post("/subscribe", { subscriptionTierId: "tier-1" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ subscriptionId: "sub_123", clientSecret: "secret_abc" });
    expect(createStripeSubscription).toHaveBeenCalledWith("agency-1", "agency@example.com", "tier-1");
  });

  it("400s without a subscriptionTierId", async () => {
    const res = await post("/subscribe", {});
    expect(res.status).toBe(400);
  });
});

describe("POST /subscribe/verify", () => {
  it("routes to the khalti verifier and logs the verification", async () => {
    verifyAndCompleteKhaltiPayment.mockResolvedValue({ id: "txn-1", status: "COMPLETED" });
    const res = await post("/subscribe/verify", { provider: "khalti", token: "t", transactionId: "txn-1" });
    expect(res.status).toBe(200);
    expect(verifyAndCompleteKhaltiPayment).toHaveBeenCalledWith("t", "txn-1", "agency-1");
  });

  it("routes to the esewa verifier", async () => {
    verifyAndCompleteEsewaPayment.mockResolvedValue({ id: "txn-2", status: "COMPLETED" });
    const res = await post("/subscribe/verify", { provider: "esewa", refId: "r", transactionId: "txn-2" });
    expect(res.status).toBe(200);
    expect(verifyAndCompleteEsewaPayment).toHaveBeenCalledWith("r", "txn-2", "agency-1");
  });

  it("400s an unknown provider", async () => {
    const res = await post("/subscribe/verify", { provider: "bogus" });
    expect(res.status).toBe(400);
  });
});

describe("payment initiation routes", () => {
  it("POST /subscribe/khalti/initiate", async () => {
    initiateKhaltiPayment.mockResolvedValue({ paymentUrl: "https://khalti.example" });
    const res = await post("/subscribe/khalti/initiate", { subscriptionTierId: "tier-1" });
    expect(res.status).toBe(200);
    expect(initiateKhaltiPayment).toHaveBeenCalledWith("agency-1", "tier-1");
  });

  it("POST /subscribe/esewa/initiate", async () => {
    initiateEsewaPayment.mockResolvedValue({ paymentUrl: "https://esewa.example" });
    const res = await post("/subscribe/esewa/initiate", { subscriptionTierId: "tier-1" });
    expect(res.status).toBe(200);
    expect(initiateEsewaPayment).toHaveBeenCalledWith("agency-1", "tier-1");
  });

  it("POST /subscribe/connectips/initiate requires bankCode/accountNumber", async () => {
    const res = await post("/subscribe/connectips/initiate", { subscriptionTierId: "tier-1" });
    expect(res.status).toBe(400);
  });

  it("POST /subscribe/connectips/initiate succeeds with all fields", async () => {
    initiateConnectIPSPayment.mockResolvedValue({ paymentUrl: "https://connectips.example" });
    const res = await post("/subscribe/connectips/initiate", {
      subscriptionTierId: "tier-1",
      bankCode: "NIC",
      accountNumber: "0001",
    });
    expect(res.status).toBe(200);
    expect(initiateConnectIPSPayment).toHaveBeenCalledWith("agency-1", "tier-1", "NIC", "0001");
  });
});

describe("fonepay routes", () => {
  it("POST /fonepay/activate", async () => {
    activateFonepay.mockResolvedValue({ activated: true });
    const res = await post("/fonepay/activate", {});
    expect(res.status).toBe(200);
    expect(activateFonepay).toHaveBeenCalledWith("agency-1");
  });

  it("POST /fonepay/qr/dynamic requires an amount", async () => {
    const res = await post("/fonepay/qr/dynamic", {});
    expect(res.status).toBe(400);
  });

  it("POST /fonepay/qr/dynamic succeeds with an amount", async () => {
    generateDynamicQR.mockResolvedValue({ qr: "data:image/png;base64,..." });
    const res = await post("/fonepay/qr/dynamic", { amount: 500 });
    expect(res.status).toBe(200);
    expect(generateDynamicQR).toHaveBeenCalledWith("agency-1", 500);
  });

  it("GET /fonepay/status requires a session", async () => {
    const res = await fetch(`${baseUrl}/fonepay/status`);
    expect(res.status).toBe(401);
  });

  it("GET /fonepay/status returns the agency's status when authenticated", async () => {
    authState.valid = true;
    getFonepayStatus.mockResolvedValue({ active: true });
    const res = await fetch(`${baseUrl}/fonepay/status`);
    expect(res.status).toBe(200);
    expect(getFonepayStatus).toHaveBeenCalledWith("agency-1");
  });

  it("POST /fonepay/verify requires no auth and validates the transaction server-side", async () => {
    processAndVerifyFonepayTransaction.mockResolvedValue({ id: "txn-3", status: "COMPLETED" });
    const res = await post(
      "/fonepay/verify",
      { agencyId: "agency-2", trekkerEmail: "t@example.com", transactionId: "txn-3", amount: 100 },
      { auth: false },
    );
    expect(res.status).toBe(200);
    expect(processAndVerifyFonepayTransaction).toHaveBeenCalledWith(
      "agency-2",
      "t@example.com",
      null,
      "txn-3",
      100,
    );
  });

  it("POST /fonepay/verify 400s on missing fields", async () => {
    const res = await post("/fonepay/verify", { agencyId: "agency-2" }, { auth: false });
    expect(res.status).toBe(400);
  });

  it("POST /fonepay/verify 500s when Fonepay verification fails", async () => {
    processAndVerifyFonepayTransaction.mockRejectedValue(new Error("Fonepay transaction verification failed"));
    const res = await post(
      "/fonepay/verify",
      { agencyId: "agency-2", trekkerEmail: "t@example.com", transactionId: "txn-4", amount: 100 },
      { auth: false },
    );
    expect(res.status).toBe(500);
  });
});
