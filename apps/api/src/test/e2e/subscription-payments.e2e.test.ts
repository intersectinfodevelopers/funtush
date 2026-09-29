// Plan checkout (eSewa + Khalti): our side of the flow, with the gateways' HTTP replies mocked.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

process.env.ESEWA_MERCHANT_CODE = "EPAYTEST";
process.env.KHALTI_SECRET_KEY = "test_secret";
process.env.BILLING_RETURN_URL = "http://localhost:3001/dashboard/billing/return";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

process.env.USD_NPR_RATE = "100"; // $99 plan → NPR 9,900
const gateway = { esewa: "Success", khalti: { status: "Completed", total_amount: 990000 } as { status: string; total_amount: number } };
const realFetch = globalThis.fetch;
function stubGateways() {
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.includes("/epayment/initiate/")) return new Response(JSON.stringify({ pidx: "pidxABC123456", payment_url: "https://pay.khalti.example/abc" }), { status: 200 });
    if (url.includes("/epayment/lookup/")) return new Response(JSON.stringify(gateway.khalti), { status: 200 });
    if (url.includes("/epay/transrec")) return new Response(`<response><response_code>${gateway.esewa}</response_code></response>`, { status: 200 });
    return realFetch(input, init);
  });
}

d("subscription payments (e2e)", () => {
  let ctx: E2EContext;
  let other: E2EContext;
  let paidTier: string;
  let freeTier: string;
  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    other = await createAgencyContext();
    const t = await db.subscriptionTier.create({ data: { name: `E2E_PAID_${Date.now()}`, monthlyPrice: 99, maxStaff: 5, maxGuides: 5, maxPackages: 5, trialDays: 0, features: {} } as never });
    paidTier = t.id;
    freeTier = ctx.tierId;
    await db.subscriptionTier.update({ where: { id: freeTier }, data: { monthlyPrice: 0 } });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.esewaTransaction.deleteMany({ where: { agencyId: { in: [ctx?.agencyId, other?.agencyId] } } });
    await db.khaltiTransaction.deleteMany({ where: { agencyId: { in: [ctx?.agencyId, other?.agencyId] } } });
    await ctx?.cleanup();
    await other?.cleanup();
    await db.agency.updateMany({ where: { tierId: paidTier }, data: { tierId: freeTier } });
    if (paidTier) await db.subscriptionTier.delete({ where: { id: paidTier } }).catch(() => undefined);
  });
  afterEach(() => { gateway.esewa = "Success"; gateway.khalti = { status: "Completed", total_amount: 990000 }; });

  const post = (path: string, body: object, c = ctx) => request(app).post(`/billing${path}`).set("x-refresh-token", c.refreshToken).send(body);
  const tierOf = async (c = ctx) => (await db.agency.findUnique({ where: { id: c.agencyId }, select: { tierId: true } }))!.tierId;

  it("refuses free plans and the plan you're already on", async () => {
    expect((await post("/subscribe/esewa/initiate", { subscriptionTierId: freeTier })).status).toBe(400);
    expect((await post("/subscribe/khalti/initiate", { subscriptionTierId: "nope" })).status).toBe(404);
    expect((await post("/subscribe/esewa/initiate", {})).status).toBe(400);
  });

  it("eSewa: initiate returns a form whose pid is this transaction's own id", async () => {
    const r = await post("/subscribe/esewa/initiate", { subscriptionTierId: paidTier });
    expect(r.status).toBe(200);
    expect(r.body.form.fields.pid).toBe(r.body.transactionId);
    expect(r.body.form.fields.su).toBe(`http://localhost:3001/dashboard/billing/return/esewa/${r.body.transactionId}`);
    expect(r.body.form.action).toMatch(/\/epay\/main$/);
    expect(r.body.amount).toBe(9900);
  });

  it("eSewa: verifies once, upgrades the plan, never another agency's transaction, never a failed gateway answer", async () => {
    stubGateways();
    const init = (await post("/subscribe/esewa/initiate", { subscriptionTierId: paidTier })).body;
    // another agency can't settle this transaction
    expect((await post("/subscribe/verify", { provider: "esewa", refId: "000AE01", transactionId: init.transactionId }, other)).status).toBe(404);
    // a gateway that doesn't confirm → refused, plan unchanged, transaction failed
    gateway.esewa = "failure";
    const bad = await post("/subscribe/verify", { provider: "esewa", refId: "000AE01", transactionId: init.transactionId });
    expect(bad.status).toBe(400);
    expect(await tierOf()).toBe(freeTier);
    // a failed transaction is not retryable (start a new payment instead)
    gateway.esewa = "Success";
    expect((await post("/subscribe/verify", { provider: "esewa", refId: "000AE01", transactionId: init.transactionId })).status).toBe(409);
    // fresh payment → success
    const init2 = (await post("/subscribe/esewa/initiate", { subscriptionTierId: paidTier })).body;
    expect((await post("/subscribe/verify", { provider: "esewa", refId: "bad ref!", transactionId: init2.transactionId })).status).toBe(400);
    const ok = await post("/subscribe/verify", { provider: "esewa", refId: "000AE02", transactionId: init2.transactionId });
    expect(ok.status).toBe(200);
    expect(await tierOf()).toBe(paidTier);
    // replaying the verification is harmless
    expect((await post("/subscribe/verify", { provider: "esewa", refId: "000AE02", transactionId: init2.transactionId })).status).toBe(200);
    // and a plan you already have can't be bought again
    expect((await post("/subscribe/esewa/initiate", { subscriptionTierId: paidTier })).status).toBe(400);
    await db.agency.update({ where: { id: ctx.agencyId }, data: { tierId: freeTier } });
  });

  it("Khalti: initiate stores the pidx, verify demands that same pidx, the exact amount and a Completed status", async () => {
    stubGateways();
    const init = await post("/subscribe/khalti/initiate", { subscriptionTierId: paidTier });
    expect(init.status).toBe(200);
    expect(init.body.redirectUrl).toBe("https://pay.khalti.example/abc");
    const id = init.body.transactionId;
    expect((await post("/subscribe/verify", { provider: "khalti", token: "someoneElsesPidx1", transactionId: id })).status).toBe(400);
    expect((await post("/subscribe/verify", { provider: "khalti", token: "pidxABC123456", transactionId: id }, other)).status).toBe(404);
    // payer hasn't finished: refused but still retryable
    gateway.khalti = { status: "Pending", total_amount: 990000 };
    expect((await post("/subscribe/verify", { provider: "khalti", token: "pidxABC123456", transactionId: id })).status).toBe(400);
    expect((await db.khaltiTransaction.findUnique({ where: { id } }))?.status).toBe("pending");
    // Completed but for a different amount → refused and burned
    gateway.khalti = { status: "Completed", total_amount: 100 };
    expect((await post("/subscribe/verify", { provider: "khalti", token: "pidxABC123456", transactionId: id })).status).toBe(400);
    expect((await db.khaltiTransaction.findUnique({ where: { id } }))?.status).toBe("failed");
    expect(await tierOf()).toBe(freeTier);
    // a clean payment
    const init2 = (await post("/subscribe/khalti/initiate", { subscriptionTierId: paidTier })).body;
    gateway.khalti = { status: "Completed", total_amount: 990000 };
    expect((await post("/subscribe/verify", { provider: "khalti", token: "pidxABC123456", transactionId: init2.transactionId })).status).toBe(200);
    expect(await tierOf()).toBe(paidTier);
  });
});
