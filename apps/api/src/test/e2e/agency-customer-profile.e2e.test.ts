// GET /customers/:id/profile — a non-customer must be a clean 404, never a 500,
// and another agency's customer must be indistinguishable from a missing one.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { normalizeEmail } from "@funtush/shared";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("Customer profile (e2e)", () => {
  let mine: E2EContext;
  let other: E2EContext;
  let myTrekker = "";
  let theirTrekker = "";
  const userIds: string[] = [];

  async function trekkerWithBooking(ctx: E2EContext, tag: string) {
    const email = `cust-${tag}-${Date.now()}@example.com`;
    const user = await db.user.create({ data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" }, select: { id: true } });
    userIds.push(user.id);
    const trekker = await db.trekker.create({ data: { userId: user.id, fullName: `Cust ${tag}` }, select: { id: true } });
    const seed = await seedPackage(ctx.agencyId);
    await db.booking.create({
      data: { agencyId: ctx.agencyId, trekkerId: trekker.id, packageId: seed.packageId, departureDateId: seed.departureDateId, groupSize: 1, totalPrice: 500, trekkerName: `Cust ${tag}`, trekkerEmail: email, trekkerPhone: "9800000000", status: "CONFIRMED" },
    });
    return trekker.id;
  }

  beforeAll(async () => {
    if (!RUN) return;
    mine = await createAgencyContext();
    other = await createAgencyContext();
    myTrekker = await trekkerWithBooking(mine, "mine");
    theirTrekker = await trekkerWithBooking(other, "theirs");
  });
  afterAll(async () => {
    for (const c of [mine, other]) {
      if (!c) continue;
      await db.booking.deleteMany({ where: { agencyId: c.agencyId } }).catch(() => {});
      await c.cleanup();
    }
    await db.trekker.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  });

  const get = (id: string) => request(app).get(`/customers/${id}/profile`).set("x-refresh-token", mine.refreshToken);

  it("returns the profile for one of the agency's own customers", async () => {
    const r = await get(myTrekker);
    expect(r.status).toBe(200);
    expect(r.body.data.data.customer.id).toBe(myTrekker);
    expect(r.body.data.data.stats.visitCount).toBe(1);
  });

  it("404s (not 500) for a nonexistent id, and identically for ANOTHER agency's customer", async () => {
    const missing = await get("00000000-0000-0000-0000-000000000000");
    const foreign = await get(theirTrekker);
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });
});
