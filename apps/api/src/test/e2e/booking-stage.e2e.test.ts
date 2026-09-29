// The clickable steps on the booking page: move a booking to any step, with seats / payment link / guide kept right.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("booking stage change (e2e)", () => {
  let ctx: E2EContext;
  let seed: Awaited<ReturnType<typeof seedPackage>>;
  const auth = () => ({ Authorization: `Bearer ${ctx.accessToken}`, "x-refresh-token": ctx.refreshToken });
  const mk = (o: object = {}) => db.booking.create({ data: { agencyId: ctx.agencyId, packageId: seed.packageId, departureDateId: seed.departureDateId, groupSize: 2, totalPrice: 200, trekkerName: "T", trekkerEmail: `t-${Math.random()}@example.com`, trekkerPhone: "9800000000", status: "INQUIRY", ...o } as never });
  const stage = (id: string, s: string) => request(app).patch(`/bookings/${id}/set-stage`).set(auth()).send({ stage: s });
  const booked = async () => (await db.trekDepartureDate.findUnique({ where: { id: seed.departureDateId } }))!.bookedSlots;
  const status = async (id: string) => (await db.booking.findUnique({ where: { id } }))!.status;

  beforeAll(async () => { if (RUN) { ctx = await createAgencyContext(); seed = await seedPackage(ctx.agencyId, { maxSlots: 10 }); } });
  afterAll(async () => { if (ctx) { await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {}); await ctx.cleanup(); } });

  it("walks a booking through every step and back; seats follow", async () => {
    const b = await mk();
    const start = await booked();
    // Inquiry → Payment is the normal "accept": seats held + payment link
    const acc = await stage(b.id, "PAYMENT_PENDING");
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(await status(b.id)).toBe("PAYMENT_PENDING");
    expect(await booked()).toBe(start + 2);
    expect(await db.paymentLink.count({ where: { bookingId: b.id, used: false } })).toBe(1);
    // Payment → Paid (offline payment): link marked used
    expect((await stage(b.id, "PAID")).status).toBe(200);
    expect((await db.paymentLink.findUnique({ where: { bookingId: b.id } }))?.used).toBe(true);
    expect((await stage(b.id, "CONFIRMED")).status).toBe(200);
    // On trek needs a guide
    const noGuide = await stage(b.id, "ACTIVE");
    expect(noGuide.status).toBe(409);
    expect(noGuide.body.message).toMatch(/Assign a guide/);
    const guide = (await request(app).post("/agencies/me/guides").set(auth()).send({ name: "Stage Guide", phone: "+977 9800000000" })).body.data;
    expect((await request(app).patch(`/bookings/${b.id}/assign-guide`).set(auth()).send({ guideRef: guide.guideRef })).status).toBe(200);
    expect((await stage(b.id, "ACTIVE")).status).toBe(200);
    expect((await stage(b.id, "COMPLETED")).status).toBe(200);
    expect(await booked()).toBe(start + 2); // seats stay taken through the whole journey
    // and back: Completed → Payment gets a FRESH live link so it isn't auto-cancelled
    expect((await stage(b.id, "PAYMENT_PENDING")).status).toBe(200);
    const link = await db.paymentLink.findUnique({ where: { bookingId: b.id } });
    expect(link?.used).toBe(false);
    expect(link!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 40 * 3600_000);
    // back to Inquiry releases the seats and clears the link
    expect((await stage(b.id, "INQUIRY")).status).toBe(200);
    expect(await booked()).toBe(start);
    expect(await db.paymentLink.count({ where: { bookingId: b.id } })).toBe(0);
    // …and it can be accepted again
    expect((await stage(b.id, "PAYMENT_PENDING")).status).toBe(200);
  });

  it("checks capacity when leaving Inquiry, refuses bad targets, and other agencies can't touch it", async () => {
    const big = await mk({ groupSize: 50 });
    const full = await stage(big.id, "PAID");
    expect(full.status).toBeGreaterThanOrEqual(400); // not enough seats
    expect(await status(big.id)).toBe("INQUIRY");
    expect((await stage(big.id, "NOPE")).status).toBe(400);
    const cancelled = await mk({ status: "CANCELLED" });
    const c = await stage(cancelled.id, "PAID");
    expect(c.status).toBe(409);
    expect(c.body.message).toMatch(/cancelled/);
    const other = await createAgencyContext();
    try {
      const r = await request(app).patch(`/bookings/${big.id}/set-stage`).set({ Authorization: `Bearer ${other.accessToken}`, "x-refresh-token": other.refreshToken }).send({ stage: "PAID" });
      expect(r.status).toBe(403);
    } finally { await other.cleanup(); }
    // same step is a harmless no-op
    const same = await mk();
    expect((await stage(same.id, "INQUIRY")).body.data.changed).toBe(false);
  });
});
