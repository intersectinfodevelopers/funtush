// Trekker invoices: strict validation, no silent coercion.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("invoice validation (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => {
    if (RUN) ctx = await createAgencyContext();
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const base = () => ({ trekkerName: "Maya Rai", lineItems: [{ description: "Everest trek", quantity: 2, unitPrice: 500 }] });
  const post = (b: object) => request(app).post("/agencies/me/finance/invoices").set("x-refresh-token", ctx.refreshToken).send(b);

  it("creates a valid invoice with computed totals", async () => {
    const r = await post({ ...base(), discount: 100, currencyCode: "usd", dueDate: "2030-01-01", issueDate: "2029-12-01" });
    expect(r.status).toBe(201);
    expect(r.body.data.total).toBe(900);
    expect(r.body.data.currencyCode).toBe("USD");
  });

  it("rejects bad input with a 400", async () => {
    for (const b of [
      { ...base(), lineItems: "nope" },
      { ...base(), lineItems: [{ description: "x", quantity: -1, unitPrice: 5 }] },
      { ...base(), lineItems: [{ description: "x", quantity: 1, unitPrice: "5" }] },
      { ...base(), discount: 5000 },
      { ...base(), discount: -1 },
      { ...base(), currencyCode: "RUPEES" },
      { ...base(), trekkerEmail: "not-an-email" },
      { ...base(), dueDate: "garbage" },
      { ...base(), issueDate: "2030-05-01", dueDate: "2030-04-01" },
      { ...base(), trekkerName: 5 },
      { ...base(), notes: "x".repeat(1001) },
      { ...base(), lineItems: Array.from({ length: 51 }, () => ({ description: "x", quantity: 1, unitPrice: 1 })) },
    ]) {
      expect((await post(b)).status, JSON.stringify(b).slice(0, 80)).toBe(400);
    }
  });

  it("validates updates too", async () => {
    const inv = (await post(base())).body.data;
    const patch = (b: object) => request(app).patch(`/agencies/me/finance/invoices/${inv.id}`).set("x-refresh-token", ctx.refreshToken).send(b);
    expect((await patch({ discount: 999999 })).status).toBe(400);
    expect((await patch({ currencyCode: "??" })).status).toBe(400);
    expect((await patch({ notes: "thanks" })).status).toBe(200);
  });
});
