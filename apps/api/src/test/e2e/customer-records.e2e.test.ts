// Customers: guests who completed a trek are listed; the agency can edit and remove customers from ITS list.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { normalizeEmail } from "@funtush/shared";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("customer records (e2e)", () => {
  let ctx: E2EContext;
  let other: E2EContext;
  let seed: Awaited<ReturnType<typeof seedPackage>>;
  let trekkerId = "";
  const userIds: string[] = [];
  const tag = Date.now().toString().slice(-6);
  const guestEmail = `Guest.${tag}@Example.com`;
  const gKey = `guest:${guestEmail.toLowerCase()}`;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  const book = (o: object) => db.booking.create({ data: { agencyId: ctx.agencyId, packageId: seed.packageId, departureDateId: seed.departureDateId, groupSize: 2, totalPrice: 1000, trekkerName: "Guest Person", trekkerEmail: guestEmail, trekkerPhone: "+977 9800000000", status: "COMPLETED", ...o } as never });
  const list = async (q = "") => (await request(app).get(`/agencies/me/customers${q}`).set(rt())).body.result;
  const keys = async (q = "") => (await list(q)).data.map((c: { trekkerId: string }) => c.trekkerId);

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    other = await createAgencyContext();
    seed = await seedPackage(ctx.agencyId);
    const email = `linked-${tag}@example.com`;
    const user = await db.user.create({ data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" }, select: { id: true } });
    userIds.push(user.id);
    trekkerId = (await db.trekker.create({ data: { userId: user.id, fullName: "Linked Trekker", phone: "+977 9811111111", country: "Nepal" }, select: { id: true } })).id;
    await book({ trekkerId, trekkerName: "Linked Trekker", trekkerEmail: email, status: "CONFIRMED", totalPrice: 500 });
    await book({ status: "COMPLETED" }); // guest, completed → a customer
    await book({ trekkerEmail: `only-inquiry-${tag}@example.com`, trekkerName: "Just Asked", status: "INQUIRY" }); // guest, never completed → not a customer
  });
  afterAll(async () => {
    for (const c of [ctx, other]) {
      if (!c) continue;
      await db.booking.deleteMany({ where: { agencyId: c.agencyId } }).catch(() => {});
      await c.cleanup();
    }
    await db.trekker.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  });

  it("lists linked trekkers AND guests who completed a trek (not guests who only enquired)", async () => {
    const k = await keys();
    expect(k).toContain(trekkerId);
    expect(k).toContain(gKey);
    expect(k.some((x: string) => x.includes("only-inquiry"))).toBe(false);
    const row = (await list()).data.find((c: { trekkerId: string }) => c.trekkerId === gKey);
    expect(row).toMatchObject({ fullName: "Guest Person", isGuest: true, totalBookings: 1, totalSpending: 1000 });
    // search + sort work across both kinds
    expect(await keys("?search=guest.")).toEqual([gKey]);
    expect(await keys("?search=Linked")).toEqual([trekkerId]);
    expect((await list("?sortBy=totalSpending&sortOrder=desc")).data[0].trekkerId).toBe(gKey);
  });

  it("a guest's profile works (notes are not available for guests)", async () => {
    const p = await request(app).get(`/customers/${encodeURIComponent(gKey)}/profile`).set(rt());
    expect(p.status).toBe(200);
    expect(p.body.data.data.customer).toMatchObject({ id: gKey, fullName: "Guest Person", isGuest: true });
    expect(p.body.data.data.bookingHistory).toHaveLength(1);
    const note = await request(app).post(`/customers/${encodeURIComponent(gKey)}/notes`).set(rt()).send({ noteText: "hi" });
    expect(note.status).toBe(400);
    // a guest who never completed a trek isn't a customer
    expect((await request(app).get(`/customers/${encodeURIComponent(`guest:only-inquiry-${tag}@example.com`)}/profile`).set(rt())).status).toBe(404);
  });

  it("edit: changes how this agency sees the customer, validates, and clears", async () => {
    const ok = await request(app).patch(`/agencies/me/customers/${encodeURIComponent(gKey)}`).set(rt()).send({ fullName: "Renamed Guest", phone: "+977 9822222222", country: "India" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await list()).data.find((c: { trekkerId: string }) => c.trekkerId === gKey)).toMatchObject({ fullName: "Renamed Guest", phone: "+977 9822222222", country: "India" });
    expect((await request(app).get(`/customers/${encodeURIComponent(gKey)}/profile`).set(rt())).body.data.data.customer.fullName).toBe("Renamed Guest");
    // a linked trekker can be edited too — without touching their account
    await request(app).patch(`/agencies/me/customers/${trekkerId}`).set(rt()).send({ fullName: "Agency Alias" });
    expect((await list()).data.find((c: { trekkerId: string }) => c.trekkerId === trekkerId).fullName).toBe("Agency Alias");
    expect((await db.trekker.findUnique({ where: { id: trekkerId } }))?.fullName).toBe("Linked Trekker");
    // clearing shows the original again
    await request(app).patch(`/agencies/me/customers/${trekkerId}`).set(rt()).send({ fullName: "" });
    expect((await list()).data.find((c: { trekkerId: string }) => c.trekkerId === trekkerId).fullName).toBe("Linked Trekker");
    // the agency can also correct a customer's email (shown in its lists; the account email is unchanged)
    const em = await request(app).patch(`/agencies/me/customers/${trekkerId}`).set(rt()).send({ email: "New.Address@Example.com" });
    expect(em.status).toBe(200);
    expect((await list()).data.find((c: { trekkerId: string }) => c.trekkerId === trekkerId).email).toBe("new.address@example.com");
    expect((await request(app).get(`/customers/${trekkerId}/profile`).set(rt())).body.data.data.customer.user.email).toBe("new.address@example.com");
    expect((await request(app).patch(`/agencies/me/customers/${trekkerId}`).set(rt()).send({ email: "not-an-email" })).body.errors.email).toBeDefined();
    await request(app).patch(`/agencies/me/customers/${trekkerId}`).set(rt()).send({ email: "" });
    // bad input
    const bad = await request(app).patch(`/agencies/me/customers/${trekkerId}`).set(rt()).send({ phone: "abc" });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.phone).toBeDefined();
    expect((await request(app).patch(`/agencies/me/customers/${trekkerId}`).set(rt()).send({})).status).toBe(400);
  });

  it("another agency can't edit or delete my customers (404), and unknown ids 404", async () => {
    const o = { "x-refresh-token": other.refreshToken };
    expect((await request(app).patch(`/agencies/me/customers/${trekkerId}`).set(o).send({ fullName: "X" })).status).toBe(404);
    expect((await request(app).delete(`/agencies/me/customers/${encodeURIComponent(gKey)}`).set(o)).status).toBe(404);
    expect((await request(app).delete(`/agencies/me/customers/00000000-0000-0000-0000-000000000000`).set(rt())).status).toBe(404);
  });

  it("delete removes the customer from the list only — and they return if they book again", async () => {
    const del = await request(app).delete(`/agencies/me/customers/${encodeURIComponent(gKey)}`).set(rt());
    expect(del.status).toBe(200);
    expect(await keys()).not.toContain(gKey);
    expect(await db.booking.count({ where: { agencyId: ctx.agencyId, trekkerEmail: guestEmail } })).toBeGreaterThan(0); // bookings kept
    await request(app).delete(`/agencies/me/customers/${trekkerId}`).set(rt());
    expect(await keys()).not.toContain(trekkerId);
    expect(await db.trekker.findUnique({ where: { id: trekkerId } })).not.toBeNull(); // account kept
    // a new completed booking after being removed brings the guest back
    await new Promise((r) => setTimeout(r, 30));
    await book({ status: "COMPLETED" });
    expect(await keys("?limit=21")).toContain(gKey); // (a different query, so the 10 s list cache isn't in the way)
  });

  it("customer analytics count guests and skip removed customers", async () => {
    const a = await request(app).get("/agencies/me/customers/analytics").set(rt());
    expect(a.status).toBe(200);
    const names = a.body.data.data.topCustomersBySpending.map((c: { trekkerId: string }) => c.trekkerId);
    expect(names).toContain(gKey);
    expect(names).not.toContain(trekkerId); // removed above
  });
});
