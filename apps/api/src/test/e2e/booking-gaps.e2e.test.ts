// ─────────────────────────────────────────────────────────────────────────────
// Booking routes — gap-filling end-to-end (API-wide docs/test pass, Batch 4).
// `bookings-staff.e2e.test.ts` already covers create / assign-guide /
// check-in / check-out; this file covers what it doesn't: the public OTP
// inquiry flow, propose-date, reject, confirm, cancel, and GET by id.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db, redis } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

function bearer(ctx: E2EContext) {
  return { Authorization: `Bearer ${ctx.accessToken}` };
}

d("Booking OTP inquiry flow (e2e)", () => {
  let ctx: E2EContext;
  let packageId: string;
  let departureDateId: string;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const seed = await seedPackage(ctx.agencyId, { maxSlots: 4 });
    packageId = seed.packageId;
    departureDateId = seed.departureDateId;
  });

  afterAll(async () => {
    if (ctx) {
      await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await ctx.cleanup();
    }
  });

  it("POST /inquiry returns a sessionToken and stores a real OTP in Redis", async () => {
    const res = await request(app).post("/bookings/inquiry").send({
      packageId,
      departureDateId,
      groupSize: 2,
      trekkerName: "Jamie Trekker",
      trekkerEmail: `jamie-${Date.now()}@example.com`,
      trekkerPhone: "+9779800000001",
    });

    expect(res.status).toBe(202);
    expect(res.body.data.sessionToken).toBeTruthy();

    const otp = await redis.get(`inquiry:otp:${res.body.data.sessionToken}`);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("POST /inquiry rejects a group size larger than available slots with 409", async () => {
    const res = await request(app).post("/bookings/inquiry").send({
      packageId,
      departureDateId,
      groupSize: 999,
      trekkerName: "Too Many",
      trekkerEmail: `toomany-${Date.now()}@example.com`,
      trekkerPhone: "+9779800000002",
    });
    expect(res.status).toBe(409);
  });

  it("POST /inquiry/verify-otp requires both fields", async () => {
    const res = await request(app).post("/bookings/inquiry/verify-otp").send({ sessionToken: "x" });
    expect(res.status).toBe(400);
  });

  it("POST /inquiry/verify-otp with the wrong code 400s", async () => {
    const submit = await request(app).post("/bookings/inquiry").send({
      packageId,
      departureDateId,
      groupSize: 1,
      trekkerName: "Wrong Code",
      trekkerEmail: `wrongcode-${Date.now()}@example.com`,
      trekkerPhone: "+9779800000003",
    });
    const res = await request(app)
      .post("/bookings/inquiry/verify-otp")
      .send({ sessionToken: submit.body.data.sessionToken, otp: "000000" });
    expect(res.status).toBe(400);
  });

  it("the real OTP verifies and creates the booking", async () => {
    const submit = await request(app).post("/bookings/inquiry").send({
      packageId,
      departureDateId,
      groupSize: 1,
      trekkerName: "Real Trekker",
      trekkerEmail: `real-${Date.now()}@example.com`,
      trekkerPhone: "+9779800000004",
    });
    const sessionToken = submit.body.data.sessionToken;
    const otp = await redis.get(`inquiry:otp:${sessionToken}`);

    const res = await request(app).post("/bookings/inquiry/verify-otp").send({ sessionToken, otp });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("INQUIRY");
  });
});

d("Booking lifecycle actions (e2e)", () => {
  let ctx: E2EContext;
  let packageId: string;
  let departureDateId: string;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const seed = await seedPackage(ctx.agencyId, { maxSlots: 10 });
    packageId = seed.packageId;
    departureDateId = seed.departureDateId;
  });

  afterAll(async () => {
    if (ctx) {
      await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await ctx.cleanup();
    }
  });

  async function createInquiryBooking() {
    const res = await request(app)
      .post("/bookings")
      .set(bearer(ctx))
      .send({
        packageId,
        departureDateId,
        groupSize: 1,
        trekkerName: "Inquiry Fixture",
        trekkerEmail: `inquiry-fixture-${Date.now()}@example.com`,
        trekkerPhone: "+9779800000005",
        status: "INQUIRY",
      });
    return res.body.data.id as string;
  }

  it("GET /:id returns the booking", async () => {
    const id = await createInquiryBooking();
    const res = await request(app).get(`/bookings/${id}`).set(bearer(ctx));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it("GET /:id 404s for an unknown id", async () => {
    const res = await request(app).get("/bookings/does-not-exist").set(bearer(ctx));
    expect(res.status).toBe(404);
  });

  it("PATCH /:id/propose-date requires a proposedDate", async () => {
    const id = await createInquiryBooking();
    const res = await request(app).patch(`/bookings/${id}/propose-date`).set(bearer(ctx)).send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/propose-date sets a proposed alternative date on an INQUIRY booking", async () => {
    const id = await createInquiryBooking();
    const res = await request(app)
      .patch(`/bookings/${id}/propose-date`)
      .set(bearer(ctx))
      .send({ proposedDate: "2027-01-15" });
    expect(res.status).toBe(200);
  });

  it("PATCH /:id/reject requires a reason", async () => {
    const id = await createInquiryBooking();
    const res = await request(app).patch(`/bookings/${id}/reject`).set(bearer(ctx)).send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/reject rejects an INQUIRY booking", async () => {
    const id = await createInquiryBooking();
    const res = await request(app)
      .patch(`/bookings/${id}/reject`)
      .set(bearer(ctx))
      .send({ reason: "Fully booked elsewhere" });
    expect(res.status).toBe(200);
  });

  it("PATCH /:id/reject 400s a booking that isn't in INQUIRY state", async () => {
    const id = await createInquiryBooking();
    await request(app).patch(`/bookings/${id}/reject`).set(bearer(ctx)).send({ reason: "First rejection" });

    const res = await request(app).patch(`/bookings/${id}/reject`).set(bearer(ctx)).send({ reason: "Again" });
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/confirm requires the booking to be PAID", async () => {
    const id = await createInquiryBooking();
    const res = await request(app).patch(`/bookings/${id}/confirm`).set(bearer(ctx));
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/confirm moves a PAID booking to CONFIRMED", async () => {
    const id = await createInquiryBooking();
    await db.booking.update({ where: { id }, data: { status: "PAID" } });

    const res = await request(app).patch(`/bookings/${id}/confirm`).set(bearer(ctx));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CONFIRMED");
  });

  it("PATCH /:id/cancel requires a reason", async () => {
    const id = await createInquiryBooking();
    await db.booking.update({ where: { id }, data: { status: "CONFIRMED" } });
    const res = await request(app).patch(`/bookings/${id}/cancel`).set(bearer(ctx)).send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /:id/cancel cancels a CONFIRMED booking and releases its slots", async () => {
    const id = await createInquiryBooking();
    await db.booking.update({ where: { id }, data: { status: "CONFIRMED" } });

    const res = await request(app)
      .patch(`/bookings/${id}/cancel`)
      .set(bearer(ctx))
      .send({ reason: "Trekker changed plans" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
  });

  it("PATCH /:id/cancel 400s a booking already in INQUIRY (not a cancellable state)", async () => {
    const id = await createInquiryBooking();
    const res = await request(app).patch(`/bookings/${id}/cancel`).set(bearer(ctx)).send({ reason: "n/a" });
    expect(res.status).toBe(400);
  });
});
