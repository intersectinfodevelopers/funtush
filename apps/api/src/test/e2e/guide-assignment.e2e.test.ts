// One trek at a time: a guide on a trek can join more people on the SAME trek, but not a different one until free.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("guide assignment rules (e2e)", () => {
  let ctx: E2EContext;
  let t1: Awaited<ReturnType<typeof seedPackage>>, t2: Awaited<ReturnType<typeof seedPackage>>;
  const auth = () => ({ Authorization: `Bearer ${ctx.accessToken}`, "x-refresh-token": ctx.refreshToken });
  const tag = Date.now().toString().slice(-6);
  const mkGuide = async (name: string) => (await request(app).post("/agencies/me/guides").set(auth()).send({ name, phone: "+977 9800000000" })).body.data as { id: string; guideRef: string };
  const mkBooking = (t: typeof t1, o: object = {}) => db.booking.create({ data: { agencyId: ctx.agencyId, packageId: t.packageId, departureDateId: t.departureDateId, groupSize: 1, totalPrice: 100, trekkerName: "T", trekkerEmail: `t-${Math.random()}@example.com`, trekkerPhone: "9800000000", status: "CONFIRMED", ...o } as never });
  const assign = (bookingId: string, guideRef: string) => request(app).patch(`/bookings/${bookingId}/assign-guide`).set(auth()).send({ guideRef });
  const status = async (guideRef: string) => (await db.guideProfile.findFirst({ where: { agencyId: ctx.agencyId, guideRef } }))?.status;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    t1 = await seedPackage(ctx.agencyId);
    t2 = await seedPackage(ctx.agencyId);
  });
  afterAll(async () => {
    if (ctx) { await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {}); await ctx.cleanup(); }
  });

  it("the same trek can take several people; a different trek is refused until the guide is free", async () => {
    const g = await mkGuide(`Anita ${tag}`);
    const [a, b, other] = [await mkBooking(t1), await mkBooking(t1), await mkBooking(t2)];
    expect((await assign(a.id, g.guideRef)).status).toBe(200);
    expect(await status(g.guideRef)).toBe("ON_TREK");
    expect((await assign(b.id, g.guideRef)).status).toBe(200); // same place, same date, another person
    const no = await assign(other.id, g.guideRef);
    expect(no.status).toBe(409);
    expect(no.body.message).toMatch(/already on another trek/);
    // the assignable list tells the dashboard the same thing
    const forT2 = await request(app).get(`/agencies/me/guides/assignable?departureDateId=${t2.departureDateId}&bookingId=${other.id}`).set(auth());
    const row = forT2.body.guides.find((x: { guideRef: string }) => x.guideRef === g.guideRef);
    expect(row).toMatchObject({ assignable: false, status: "on_trek" });
    expect(row.reason).toMatch(/another trek/);
    const forT1 = await request(app).get(`/agencies/me/guides/assignable?departureDateId=${t1.departureDateId}`).set(auth());
    expect(forT1.body.guides.find((x: { guideRef: string }) => x.guideRef === g.guideRef).assignable).toBe(true);

    // the agency can free the guide by hand (Guides → Edit → Available) …
    const free = await request(app).patch(`/agencies/me/guides/${g.id}`).set(auth()).send({ status: "available" });
    expect(free.status).toBe(200);
    expect((await assign(other.id, g.guideRef)).status).toBe(200);
  });

  it("a guide is freed automatically when their treks are over, and by being replaced", async () => {
    const g = await mkGuide(`Barun ${tag}`);
    const one = await mkBooking(t1);
    await assign(one.id, g.guideRef);
    expect(await status(g.guideRef)).toBe("ON_TREK");
    await db.booking.update({ where: { id: one.id }, data: { status: "COMPLETED" } });
    const list = await request(app).get("/agencies/me/guides").set(auth());
    expect(list.body.guides.find((x: { id: string }) => x.id === g.id).status).toBe("available"); // freed on next look
    const elsewhere = await mkBooking(t2);
    expect((await assign(elsewhere.id, g.guideRef)).status).toBe(200);

    // replaced on a booking → the old guide is free again
    const g2 = await mkGuide(`Carma ${tag}`);
    expect((await assign(elsewhere.id, g2.guideRef)).status).toBe(200);
    expect(await status(g.guideRef)).toBe("AVAILABLE");
    expect(await status(g2.guideRef)).toBe("ON_TREK");
  });

  it("an unavailable guide can't be assigned until made available", async () => {
    const g = await mkGuide(`Dawa ${tag}`);
    await request(app).patch(`/agencies/me/guides/${g.id}`).set(auth()).send({ status: "unavailable" });
    const bk = await mkBooking(t1);
    const r = await assign(bk.id, g.guideRef);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/marked unavailable/);
    await request(app).patch(`/agencies/me/guides/${g.id}`).set(auth()).send({ status: "available" });
    expect((await assign(bk.id, g.guideRef)).status).toBe(200);
  });

  it("creating a booking with a guide follows the same rules", async () => {
    const g = await mkGuide(`Ella ${tag}`);
    const one = await mkBooking(t1);
    await assign(one.id, g.guideRef);
    const body = { packageId: t2.packageId, departureDateId: t2.departureDateId, groupSize: 1, trekkerName: "Maya", trekkerEmail: `m-${tag}@example.com`, trekkerPhone: "+977 9800000000", guideRef: g.guideRef };
    const busy = await request(app).post("/bookings").set(auth()).send(body);
    expect(busy.status).toBe(409);
    expect(busy.body.message).toMatch(/already on another trek/);
    const same = await request(app).post("/bookings").set(auth()).send({ ...body, packageId: t1.packageId, departureDateId: t1.departureDateId });
    expect(same.status, JSON.stringify(same.body)).toBe(201);
  });

  it("a guide on a trek that isn't finished can't be deleted", async () => {
    const g = await mkGuide(`Fara ${tag}`);
    const bk = await mkBooking(t1);
    await assign(bk.id, g.guideRef);
    const del = await request(app).delete(`/agencies/me/guides/${g.id}`).set(auth());
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/isn't completed yet/);
    await db.booking.update({ where: { id: bk.id }, data: { status: "COMPLETED" } });
    expect((await request(app).delete(`/agencies/me/guides/${g.id}`).set(auth())).status).toBe(204);
  });
});

