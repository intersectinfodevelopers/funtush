// ─────────────────────────────────────────────────────────────────────────────
// Package routes — gap-filling end-to-end (API-wide docs/test pass, Batch 4).
// `phase2-modules.e2e.test.ts` already covers package add-ons; this file
// covers duplicate, the itinerary builder (add/update/delete/reorder), and
// departure dates (add/update/delete).
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

function refresh(ctx: E2EContext) {
  return { "x-refresh-token": ctx.refreshToken };
}

d("Package duplicate + itinerary + departure dates (e2e)", () => {
  let ctx: E2EContext;
  let packageId: string;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const pkg = await db.trekPackage.create({
      data: {
        agencyId: ctx.agencyId,
        title: "Gap Test Trek",
        slug: `gap-test-trek-${Date.now()}`,
        durationDays: 5,
        pricePerPerson: 500,
        difficulty: "MODERATE",
        maxGroupSize: 10,
        status: "DRAFT",
      },
    });
    packageId = pkg.id;
  });

  afterAll(async () => {
    if (ctx) {
      await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await db.trekPackage.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await ctx.cleanup();
    }
  });

  it("401s every route without a token", async () => {
    expect((await request(app).post(`/agencies/packages/${packageId}/duplicate`)).status).toBe(401);
    expect((await request(app).post(`/agencies/packages/${packageId}/itinerary`)).status).toBe(401);
    expect((await request(app).post(`/agencies/packages/${packageId}/dates`)).status).toBe(401);
  });

  it("POST /duplicate creates a second DRAFT package", async () => {
    const res = await request(app)
      .post(`/agencies/packages/${packageId}/duplicate`)
      .set(refresh(ctx));
    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(packageId);
    expect(res.body.data.status).toBe("DRAFT");
  });

  it("POST /duplicate 404s an unknown or cross-agency package", async () => {
    const res = await request(app).post("/agencies/packages/does-not-exist/duplicate").set(refresh(ctx));
    expect(res.status).toBe(404);
  });

  let day1Id: string;
  let day2Id: string;

  it("POST /itinerary adds a day", async () => {
    const res = await request(app)
      .post(`/agencies/packages/${packageId}/itinerary`)
      .set(refresh(ctx))
      .send({ dayNumber: 1, location: "Lukla", description: "Fly in" });
    expect(res.status).toBe(201);
    day1Id = res.body.data.id;

    const res2 = await request(app)
      .post(`/agencies/packages/${packageId}/itinerary`)
      .set(refresh(ctx))
      .send({ dayNumber: 2, location: "Namche", description: "Acclimatize" });
    expect(res2.status).toBe(201);
    day2Id = res2.body.data.id;
  });

  it("POST /itinerary rejects a duplicate dayNumber", async () => {
    const res = await request(app)
      .post(`/agencies/packages/${packageId}/itinerary`)
      .set(refresh(ctx))
      .send({ dayNumber: 1, location: "Dup" });
    expect(res.status).toBe(400);
  });

  it("PUT /itinerary/:day replaces one day", async () => {
    const res = await request(app)
      .put(`/agencies/packages/${packageId}/itinerary/1`)
      .set(refresh(ctx))
      .send({ location: "Lukla (updated)", description: "Fly in, weather permitting" });
    expect(res.status).toBe(200);
    expect(res.body.data.location).toBe("Lukla (updated)");
  });

  it("PUT /itinerary/:day rejects a non-integer day param", async () => {
    const res = await request(app)
      .put(`/agencies/packages/${packageId}/itinerary/not-a-number`)
      .set(refresh(ctx))
      .send({ location: "x" });
    expect(res.status).toBe(400);
  });

  it("PATCH /itinerary/reorder swaps day order", async () => {
    const res = await request(app)
      .patch(`/agencies/packages/${packageId}/itinerary/reorder`)
      .set(refresh(ctx))
      .send({ order: [day2Id, day1Id] });
    expect(res.status).toBe(200);

    const namche = res.body.data.find((d: { id: string }) => d.id === day2Id);
    expect(namche.dayNumber).toBe(1);
  });

  it("PATCH /itinerary/reorder rejects an order missing a day", async () => {
    const res = await request(app)
      .patch(`/agencies/packages/${packageId}/itinerary/reorder`)
      .set(refresh(ctx))
      .send({ order: [day1Id] });
    expect(res.status).toBe(400);
  });

  it("DELETE /itinerary/:day removes a day", async () => {
    const res = await request(app).delete(`/agencies/packages/${packageId}/itinerary/2`).set(refresh(ctx));
    expect(res.status).toBe(200);
  });

  let dateId: string;

  it("POST /dates adds a departure date", async () => {
    const res = await request(app)
      .post(`/agencies/packages/${packageId}/dates`)
      .set(refresh(ctx))
      .send({ startDate: "2027-03-01", maxSlots: 8 });
    expect(res.status).toBe(201);
    dateId = res.body.data.id;
  });

  it("PATCH /dates/:dateId updates capacity", async () => {
    const res = await request(app)
      .patch(`/agencies/packages/${packageId}/dates/${dateId}`)
      .set(refresh(ctx))
      .send({ maxSlots: 12 });
    expect(res.status).toBe(200);
  });

  it("DELETE /dates/:dateId removes a departure date with no bookings", async () => {
    const res = await request(app).delete(`/agencies/packages/${packageId}/dates/${dateId}`).set(refresh(ctx));
    expect(res.status).toBe(200);
  });

  it("DELETE /dates/:dateId is blocked (409-ish 400) when the date has bookings", async () => {
    const departure = await db.trekDepartureDate.create({
      data: { packageId, startDate: new Date("2027-04-01"), maxSlots: 5, bookedSlots: 1, status: "AVAILABLE" },
    });
    await db.booking.create({
      data: {
        agencyId: ctx.agencyId,
        packageId,
        departureDateId: departure.id,
        groupSize: 1,
        totalPrice: 500,
        trekkerName: "Blocker",
        trekkerEmail: `blocker-${Date.now()}@example.com`,
        trekkerPhone: "+9779800000009",
      },
    });

    const res = await request(app)
      .delete(`/agencies/packages/${packageId}/dates/${departure.id}`)
      .set(refresh(ctx));
    expect(res.status).toBe(400);
  });
});
