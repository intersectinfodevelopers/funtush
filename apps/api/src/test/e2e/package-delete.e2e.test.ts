// Archived packages stay editable and can be deleted for good — unless they were ever booked.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("archived package edit + permanent delete (e2e)", () => {
  let ctx: E2EContext;
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  const make = (title: string, status: "DRAFT" | "ARCHIVED") =>
    db.trekPackage.create({ data: { agencyId: ctx.agencyId, title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}`, durationDays: 3, pricePerPerson: 100, difficulty: "EASY", maxGroupSize: 5, status } });

  beforeAll(async () => { if (RUN) ctx = await createAgencyContext(); });
  afterAll(async () => { await ctx?.cleanup(); });

  it("an archived package can still be edited", async () => {
    const p = await make("Old Trek", "ARCHIVED");
    const r = await request(app).patch(`/agencies/packages/${p.id}`).set(rt()).send({ title: "Old Trek v2" });
    expect(r.status).toBe(200);
    expect(r.body.data.title).toBe("Old Trek v2");
    expect(r.body.data.status).toBe("ARCHIVED");
  });

  it("DELETE archives; DELETE ?permanent=true removes an archived package for good", async () => {
    const p = await make("Doomed Trek", "DRAFT");
    // a live package can't be wiped in one step
    expect((await request(app).delete(`/agencies/packages/${p.id}?permanent=true`).set(rt())).status).toBe(409);
    expect((await request(app).delete(`/agencies/packages/${p.id}`).set(rt())).status).toBe(200);
    expect((await db.trekPackage.findUnique({ where: { id: p.id } }))?.status).toBe("ARCHIVED");
    expect((await request(app).delete(`/agencies/packages/${p.id}?permanent=true`).set(rt())).status).toBe(200);
    expect(await db.trekPackage.findUnique({ where: { id: p.id } })).toBeNull();
  });

  it("a package with bookings can't be deleted permanently, and other agencies' packages are untouchable", async () => {
    const p = await make("Booked Trek", "ARCHIVED");
    const other = await createAgencyContext();
    try {
      expect((await request(app).delete(`/agencies/packages/${p.id}?permanent=true`).set({ "x-refresh-token": other.refreshToken })).status).toBe(404);
      const anyBooking = await db.booking.findFirst({ select: { id: true } });
      if (anyBooking) {
        await db.booking.update({ where: { id: anyBooking.id }, data: { packageId: p.id } });
        expect((await request(app).delete(`/agencies/packages/${p.id}?permanent=true`).set(rt())).status).toBe(409);
        expect(await db.trekPackage.findUnique({ where: { id: p.id } })).not.toBeNull();
      }
    } finally {
      await other.cleanup();
    }
  });
});
