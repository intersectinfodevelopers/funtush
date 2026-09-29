// A brand-new agency has no chart of accounts; the first income/expense/statement must just work.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("finance on a fresh agency (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => {
    if (RUN) ctx = await createAgencyContext();
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const h = () => ({ "x-refresh-token": ctx.refreshToken });

  it("has no accounts until the first use, then seeds the default chart exactly once", async () => {
    expect(await db.account.count({ where: { agencyId: ctx.agencyId } })).toBe(0);
    const r = await request(app).post("/agencies/me/finance/income").set(h()).send({ amount: 1000, description: "Deposit" });
    expect(r.status).toBe(201);
    const n = await db.account.count({ where: { agencyId: ctx.agencyId } });
    expect(n).toBeGreaterThan(20);
    await request(app).post("/agencies/me/finance/expenses").set(h()).send({ amount: 200, category: "permits" });
    expect(await db.account.count({ where: { agencyId: ctx.agencyId } })).toBe(n);
  });

  it("statements and transactions work afterwards", async () => {
    const pnl = await request(app).get("/agencies/me/finance/pnl").set(h());
    expect(pnl.status).toBe(200);
    expect(pnl.body.data.revenue.total).toBe(1000);
    expect(pnl.body.data.netProfit).toBe(800);
    expect((await request(app).get("/agencies/me/finance/cash-flow").set(h())).status).toBe(200);
    const tx = await request(app).get("/agencies/me/finance/transactions").set(h());
    expect(tx.body.pagination.total).toBe(4); // 2 entries × 2 journal lines
  });

  it("filters transactions by account type and rejects an unknown type", async () => {
    const inc = await request(app).get("/agencies/me/finance/transactions?type=REVENUE").set(h());
    expect(inc.body.data.every((l: { account: { type: string } }) => l.account.type === "REVENUE")).toBe(true);
    expect(inc.body.pagination.total).toBe(1);
    const exp = await request(app).get("/agencies/me/finance/transactions?type=EXPENSE").set(h());
    expect(exp.body.pagination.total).toBe(1);
    expect((await request(app).get("/agencies/me/finance/transactions?type=NOPE").set(h())).status).toBe(400);
  });

  it("does not re-seed an agency that already has (any) accounts", async () => {
    await db.account.updateMany({ where: { agencyId: ctx.agencyId, code: "4900" }, data: { isActive: false } });
    const before = await db.account.count({ where: { agencyId: ctx.agencyId } });
    await request(app).post("/agencies/me/finance/income").set(h()).send({ amount: 5, revenueAccountCode: "4900" });
    expect(await db.account.count({ where: { agencyId: ctx.agencyId } })).toBe(before);
  });
});
