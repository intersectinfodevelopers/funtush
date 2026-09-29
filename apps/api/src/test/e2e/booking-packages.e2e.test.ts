// How bookings behave against the new package rules: group discounts, past / archived packages, currency in payloads.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { redis } from "../../lib/redis";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("bookings vs package rules (e2e)", () => {
  let ctx: E2EContext;
  let packageId: string;
  let departureDateId: string;
  const tag = Date.now().toString().slice(-6);
  const auth = () => ({ Authorization: `Bearer ${ctx.accessToken}`, "x-refresh-token": ctx.refreshToken });
  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const s = await seedPackage(ctx.agencyId, { pricePerPerson: 1000 });
    packageId = s.packageId;
    departureDateId = s.departureDateId;
    await db.trekDepartureDate.update({ where: { id: departureDateId }, data: { maxSlots: 40 } });
    await db.trekPackage.update({ where: { id: packageId }, data: { currency: "USD", volumeDiscounts: [{ minPeople: 4, percentOff: 10 }, { minPeople: 8, percentOff: 20 }] } });
  });
  afterAll(async () => { await ctx?.cleanup(); });

  const manual = (o: object = {}) => request(app).post("/bookings").set(auth()).send({ packageId, departureDateId, groupSize: 2, trekkerName: "Maya Rai", trekkerEmail: `m-${tag}@example.com`, trekkerPhone: "+977 9800000000", ...o });

  it("agency-created bookings apply the group discount server-side", async () => {
    const two = await manual({ groupSize: 2 });
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    expect(Number(two.body.data.totalPrice)).toBe(2000); // no tier yet
    const four = await manual({ groupSize: 4 });
    expect(Number(four.body.data.totalPrice)).toBe(3600); // 4 × 900
    const nine = await manual({ groupSize: 9 });
    expect(Number(nine.body.data.totalPrice)).toBe(7200); // 9 × 800
  });

  it("the public inquiry (after the emailed code) is priced with the same discount", async () => {
    const email = `pub-${tag}@example.com`;
    const sub = await request(app).post("/bookings/inquiry").send({ packageId, departureDateId, groupSize: 4, trekkerName: "Maya Rai", trekkerEmail: email, trekkerPhone: "+977 9800000000" });
    expect(sub.status).toBe(202);
    const token = sub.body.data.sessionToken;
    const otp = await redis.get(`inquiry:otp:${token}`);
    const ok = await request(app).post("/bookings/inquiry/verify-otp").send({ sessionToken: token, otp });
    expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
    const row = await db.booking.findFirst({ where: { packageId, trekkerEmail: email } });
    expect(Number(row?.totalPrice)).toBe(3600);
  });

  it("booking list and detail carry the package currency", async () => {
    const list = await request(app).get("/bookings").set(auth());
    expect(list.status).toBe(200);
    const b = list.body.data.bookings.find((x: { packageId: string }) => x.packageId === packageId);
    expect(b.package.currency).toBe("USD");
    const one = await request(app).get(`/bookings/${b.id}`).set(auth());
    expect(one.body.data.package.currency).toBe("USD");
  });

  it("a departure that has passed can't be booked, publicly or by the agency", async () => {
    const past = await db.trekDepartureDate.create({ data: { packageId, startDate: new Date(Date.now() - 3 * 86_400_000), maxSlots: 5, bookedSlots: 0, status: "AVAILABLE" } });
    const pub = await request(app).post("/bookings/inquiry").send({ packageId, departureDateId: past.id, groupSize: 2, trekkerName: "Maya Rai", trekkerEmail: `late-${tag}@example.com`, trekkerPhone: "+977 9800000000" });
    expect(pub.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(pub.body)).toMatch(/already passed/);
    const m = await manual({ departureDateId: past.id });
    expect(m.status).toBe(400);
    expect(JSON.stringify(m.body)).toMatch(/already passed/);
  });

  it("an archived or draft package takes no bookings", async () => {
    for (const status of ["ARCHIVED", "DRAFT"] as const) {
      await db.trekPackage.update({ where: { id: packageId }, data: { status } });
      const pub = await request(app).post("/bookings/inquiry").send({ packageId, departureDateId, groupSize: 2, trekkerName: "Maya Rai", trekkerEmail: `st-${status}-${tag}@example.com`, trekkerPhone: "+977 9800000000" });
      expect(pub.status, status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(pub.body)).toMatch(/not available/);
      const m = await manual();
      expect(m.status, status).toBe(400);
      expect(JSON.stringify(m.body)).toMatch(/published package/);
    }
    await db.trekPackage.update({ where: { id: packageId }, data: { status: "PUBLISHED" } });
  });

  it("archiving a package keeps its bookings intact", async () => {
    const before = await db.booking.count({ where: { packageId } });
    expect(before).toBeGreaterThan(0);
    await db.trekPackage.update({ where: { id: packageId }, data: { status: "ARCHIVED" } });
    const list = await request(app).get("/bookings").set(auth());
    expect(list.body.data.bookings.filter((x: { packageId: string }) => x.packageId === packageId)).toHaveLength(before);
    // and it can't be permanently deleted while bookings exist
    const del = await request(app).delete(`/agencies/packages/${packageId}?permanent=true`).set({ "x-refresh-token": ctx.refreshToken });
    expect(del.status).toBe(409);
  });
});
