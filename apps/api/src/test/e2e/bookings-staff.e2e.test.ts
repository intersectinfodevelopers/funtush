// ─────────────────────────────────────────────────────────────────────────────
// Bookings (manual create + guide assign + lifecycle) and Staff — end-to-end.
//
// These routes use the JWT Bearer credential (@funtush/auth requireAuth +
// requireRole["AGENCY_ADMIN"]), not the x-refresh-token header.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { createAgencyContext, seedPackage, dbAvailable, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("Bookings & staff (e2e)", () => {
  let ctx: E2EContext;
  const bearer = () => ({ Authorization: `Bearer ${ctx.accessToken}` });
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });

  beforeAll(async () => {
    ctx = await createAgencyContext({ tierName: "E2E_BOOKINGS_STAFF", maxStaff: 10, maxGuides: 10 });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  // ── Manual booking creation ────────────────────────────────────────────────
  describe("POST /bookings (manual)", () => {
    let packageId = "";
    let departureDateId = "";
    let addOnId = "";
    let departureStart: Date;

    beforeAll(async () => {
      ({ packageId, departureDateId, addOnId, departureStart } = await seedPackage(ctx.agencyId, { maxSlots: 6 }));
    });

    it("401 without a token", async () => {
      const res = await request(app).post("/bookings").send({ packageId });
      expect(res.status).toBe(401);
    });

    it("creates a CONFIRMED booking, reserves seats, computes price", async () => {
      const res = await request(app)
        .post("/bookings")
        .set(bearer())
        .send({
          packageId,
          departureDateId,
          groupSize: 2,
          trekkerName: "Walk In",
          trekkerEmail: "walkin@example.com",
          trekkerPhone: "+977 9811111111",
          trekkerCountry: "NP",
          addOns: [{ addOnId, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("CONFIRMED");
      // 2 * 1200 (base) + 200 * 2 (per-person add-on) = 2800
      expect(res.body.data.totalPrice).toBe(2800);
      expect(res.body.data.addOns).toHaveLength(1);

      const dep = await db.trekDepartureDate.findUnique({ where: { id: departureDateId } });
      expect(dep?.bookedSlots).toBe(2);
    });

    it("accepts an ISO departureDate instead of an id (INQUIRY, no reservation)", async () => {
      const iso = departureStart.toISOString().slice(0, 10);
      const res = await request(app)
        .post("/bookings")
        .set(bearer())
        .send({
          packageId,
          departureDate: iso,
          groupSize: 1,
          status: "INQUIRY",
          trekkerName: "Phone Booking",
          trekkerEmail: "phone@example.com",
          trekkerPhone: "+977 9822222222",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("INQUIRY");

      const dep = await db.trekDepartureDate.findUnique({ where: { id: departureDateId } });
      expect(dep?.bookedSlots).toBe(2); // unchanged by an INQUIRY
    });

    it("missing trekker fields → 400", async () => {
      const res = await request(app)
        .post("/bookings")
        .set(bearer())
        .send({ packageId, departureDateId, groupSize: 1 });
      expect(res.status).toBe(400);
    });

    it("another agency's package → 404", async () => {
      const other = await createAgencyContext({ tierName: "E2E_BOOKINGS_OTHER" });
      try {
        const res = await request(app)
          .post("/bookings")
          .set({ Authorization: `Bearer ${other.accessToken}` })
          .send({
            packageId,
            departureDateId,
            groupSize: 1,
            trekkerName: "x",
            trekkerEmail: "x@example.com",
            trekkerPhone: "1",
          });
        expect(res.status).toBe(404);
      } finally {
        await other.cleanup();
      }
    });

    it("overbooking a CONFIRMED booking → 400/409", async () => {
      const res = await request(app)
        .post("/bookings")
        .set(bearer())
        .send({
          packageId,
          departureDateId,
          groupSize: 50,
          trekkerName: "Too Big",
          trekkerEmail: "big@example.com",
          trekkerPhone: "1",
        });
      expect([400, 409]).toContain(res.status);
    });
  });

  // ── Guide assignment + status lifecycle ────────────────────────────────────
  describe("PATCH /bookings/:id — guide assignment + check-in/out", () => {
    let bookingId = "";
    let guideRef = "";

    beforeAll(async () => {
      const { packageId, departureDateId } = await seedPackage(ctx.agencyId, { maxSlots: 10 });
      // Manual create → status CONFIRMED, which is what assignGuide / check-in need.
      const booking = await request(app)
        .post("/bookings")
        .set(bearer())
        .send({
          packageId,
          departureDateId,
          groupSize: 1,
          trekkerName: "Lifecycle",
          trekkerEmail: "life@example.com",
          trekkerPhone: "1",
        });
      bookingId = booking.body.data.id;

      const guide = await request(app)
        .post("/agencies/me/guides")
        .set(rt())
        .send({ name: "Assign Me", phone: "+977 9800000009" });
      guideRef = guide.body.data.guideRef;
    });

    it("assigns a guide to the CONFIRMED booking", async () => {
      const res = await request(app)
        .patch(`/bookings/${bookingId}/assign-guide`)
        .set(bearer())
        .send({ guideRef });
      expect(res.status).toBe(200);
      expect(res.body.data.assignedGuideId).toBe(guideRef);
    });

    it("rejects an unknown guide (404)", async () => {
      const res = await request(app)
        .patch(`/bookings/${bookingId}/assign-guide`)
        .set(bearer())
        .send({ guideRef: "does-not-exist" });
      expect(res.status).toBe(404);
    });

    it("check-in moves CONFIRMED → ACTIVE, check-out ACTIVE → COMPLETED", async () => {
      const inRes = await request(app).patch(`/bookings/${bookingId}/check-in`).set(bearer());
      expect(inRes.status).toBe(200);
      expect(inRes.body.data.status).toBe("ACTIVE");

      const outRes = await request(app).patch(`/bookings/${bookingId}/check-out`).set(bearer());
      expect(outRes.status).toBe(200);
      expect(outRes.body.data.status).toBe("COMPLETED");
    });

    it("check-out again on a COMPLETED booking is rejected", async () => {
      const res = await request(app).patch(`/bookings/${bookingId}/check-out`).set(bearer());
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── Staff ──────────────────────────────────────────────────────────────────
  describe("Staff CRUD", () => {
    let staffId = "";
    let roleId = "";

    beforeAll(async () => {
      const role = await request(app)
        .post("/agencies/me/roles")
        .set(rt())
        .send({ name: "E2E Staff Role" });
      roleId = role.body.data.id;
    });

    it("401 without a token", async () => {
      const res = await request(app).get("/agencies/me/staff");
      expect(res.status).toBe(401);
    });

    it("POST invites a staff member with name + phone", async () => {
      const res = await request(app)
        .post("/agencies/me/staff")
        .set(bearer())
        .send({
          email: `e2e-staff-${Date.now()}@example.com`,
          name: "Suresh Gurung",
          phone: "+977 9843333333",
          roleId,
        });
      expect(res.status).toBe(201);
      expect(res.body.staff.name).toBe("Suresh Gurung");
      expect(res.body.staff.phone).toBe("+977 9843333333");
      expect(res.body.tempPassword).toBeTruthy();
      staffId = res.body.staff.id;
    });

    it("duplicate email → 409", async () => {
      const email = `e2e-dupe-${Date.now()}@example.com`;
      await request(app).post("/agencies/me/staff").set(bearer()).send({ email });
      const res = await request(app).post("/agencies/me/staff").set(bearer()).send({ email });
      expect(res.status).toBe(409);
    });

    it("GET list includes the invited member", async () => {
      const res = await request(app).get("/agencies/me/staff").set(bearer());
      expect(res.status).toBe(200);
      expect(res.body.staff.some((s: { id: string }) => s.id === staffId)).toBe(true);
    });

    it("PATCH /:id updates name / phone / email", async () => {
      const newEmail = `e2e-moved-${Date.now()}@example.com`;
      const res = await request(app)
        .patch(`/agencies/me/staff/${staffId}`)
        .set(bearer())
        .send({ name: "Suresh G.", phone: "+977 9840000000", email: newEmail });
      expect(res.status).toBe(200);
      expect(res.body.staff.name).toBe("Suresh G.");
      expect(res.body.staff.phone).toBe("+977 9840000000");
      expect(res.body.staff.user.user.email).toBe(newEmail);
    });

    it("PATCH /:id with an empty body → 400", async () => {
      const res = await request(app).patch(`/agencies/me/staff/${staffId}`).set(bearer()).send({});
      expect(res.status).toBe(400);
    });

    it("PATCH /:id for an unknown staff id → 404", async () => {
      const res = await request(app)
        .patch(`/agencies/me/staff/does-not-exist`)
        .set(bearer())
        .send({ name: "x" });
      expect(res.status).toBe(404);
    });

    it("PATCH /:id/role reassigns the role", async () => {
      const other = await request(app).post("/agencies/me/roles").set(rt()).send({ name: `Role2-${Date.now()}` });
      const res = await request(app)
        .patch(`/agencies/me/staff/${staffId}/role`)
        .set(bearer())
        .send({ roleId: other.body.data.id });
      expect(res.status).toBe(200);
      expect(res.body.staff.role.id).toBe(other.body.data.id);
    });

    it("DELETE /:id deactivates (removed from the active list)", async () => {
      const res = await request(app).delete(`/agencies/me/staff/${staffId}`).set(bearer());
      expect(res.status).toBe(200);
      const list = await request(app).get("/agencies/me/staff").set(bearer());
      expect(list.body.staff.some((s: { id: string }) => s.id === staffId)).toBe(false);
    });
  });
});
