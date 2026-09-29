// Agency coupons: validation of the stored discount, tenant scoping, delete.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("agency coupons (e2e)", () => {
  let ctx: E2EContext;
  let other: E2EContext;
  let ownPkg: string;
  let otherPkg: string;
  const base = () => ({ code: "save10", discountType: "PERCENTAGE", discountValue: 10, maxRedemptions: 5, validFrom: "2030-01-01", validUntil: "2030-12-31" });

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    other = await createAgencyContext();
    ownPkg = (await seedPackage(ctx.agencyId)).packageId;
    otherPkg = (await seedPackage(other.agencyId)).packageId;
  });
  afterAll(async () => {
    await ctx?.cleanup();
    await other?.cleanup();
  });
  const post = (b: object, c = ctx) => request(app).post("/agencies/me/coupons").set("x-refresh-token", c.refreshToken).send(b);
  const patch = (id: string, b: object, c = ctx) => request(app).patch(`/agencies/me/coupons/${id}`).set("x-refresh-token", c.refreshToken).send(b);

  it("normalizes the code and rejects a duplicate in any letter case", async () => {
    const a = await post(base());
    expect(a.status).toBe(201);
    expect(a.body.data.code).toBe("SAVE10");
    const dup = await post({ ...base(), code: "Save10" });
    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/already exists/);
  });

  it("rejects malformed input with a clear 400, never a 500", async () => {
    for (const b of [
      { ...base(), code: 42 },
      { ...base(), code: "a b" },
      { ...base(), discountType: "BOGUS" },
      { ...base(), discountValue: "10" },
      { ...base(), discountValue: 101 },
      { ...base(), code: "X1", maxRedemptions: 1.5 },
      { ...base(), code: "X2", validUntil: "2029-01-01" },
      { ...base(), code: "X3", status: "NOPE" },
    ]) {
      const r = await post(b);
      expect(r.status, JSON.stringify(b)).toBe(400);
    }
  });

  it("only accepts the agency's own packages", async () => {
    expect((await post({ ...base(), code: "OWN", applicablePackages: [ownPkg] })).status).toBe(201);
    expect((await post({ ...base(), code: "FOREIGN", applicablePackages: [otherPkg] })).status).toBe(400);
  });

  it("validates a value-only update against the stored discount type", async () => {
    const c = (await post({ ...base(), code: "PCT" })).body.data;
    const r = await patch(c.id, { discountValue: 500 });
    expect(r.status).toBe(400);
    expect((await patch(c.id, { discountValue: 25 })).body.data.discountValue).toBe(25);
  });

  it("cannot lower max redemptions below what was used", async () => {
    const c = (await post({ ...base(), code: "USED" })).body.data;
    const { db } = await import("@funtush/database");
    await db.coupon.update({ where: { id: c.id }, data: { redemptionsUsed: 4 } });
    expect((await patch(c.id, { maxRedemptions: 2 })).status).toBe(400);
    expect((await patch(c.id, { maxRedemptions: 4 })).status).toBe(200);
  });

  it("404s on another agency's coupon and deletes only its own", async () => {
    const c = (await post({ ...base(), code: "DEL" })).body.data;
    expect((await patch(c.id, { status: "PAUSED" }, other)).status).toBe(404);
    expect((await request(app).delete(`/agencies/me/coupons/${c.id}`).set("x-refresh-token", other.refreshToken)).status).toBe(404);
    expect((await request(app).delete(`/agencies/me/coupons/${c.id}`).set("x-refresh-token", ctx.refreshToken)).status).toBe(204);
    const list = await request(app).get("/agencies/me/coupons").set("x-refresh-token", ctx.refreshToken);
    expect(list.body.data.some((x: { id: string }) => x.id === c.id)).toBe(false);
  });
});
