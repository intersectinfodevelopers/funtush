// A newly published destination is announced (once) to the agency's customers who have a Funtush account.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { normalizeEmail } from "@funtush/shared";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("new destination announcement (e2e)", () => {
  let ctx: E2EContext;
  const userIds: string[] = [];
  let trekkerA = "", trekkerB = "", stranger = "";
  const tag = Date.now().toString().slice(-6);
  const rt = () => ({ "x-refresh-token": ctx.refreshToken });
  const settle = () => new Promise((r) => setTimeout(r, 700));
  const inbox = (id: string) => db.trekkerNotification.findMany({ where: { trekkerId: id, title: { contains: "New destination" } } });

  async function trekker(name: string) {
    const email = `${name}-${tag}@example.com`;
    const user = await db.user.create({ data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" }, select: { id: true } });
    userIds.push(user.id);
    return (await db.trekker.create({ data: { userId: user.id, fullName: name }, select: { id: true } })).id;
  }

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const seed = await seedPackage(ctx.agencyId);
    trekkerA = await trekker("annie");
    trekkerB = await trekker("bruno");
    stranger = await trekker("stranger"); // never booked with this agency
    for (const t of [trekkerA, trekkerB]) {
      await db.booking.create({ data: { agencyId: ctx.agencyId, trekkerId: t, packageId: seed.packageId, departureDateId: seed.departureDateId, groupSize: 1, totalPrice: 100, trekkerName: "x", trekkerEmail: `x-${t}@example.com`, trekkerPhone: "9800000000", status: "COMPLETED" } as never });
    }
  });
  afterAll(async () => {
    if (ctx) { await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {}); await ctx.cleanup(); }
    await db.trekker.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  });

  it("publishing a new destination notifies customers — not strangers, not for drafts, and only once", async () => {
    const draft = await request(app).post("/agencies/me/destinations").set(rt()).send({ title: `Draft Place ${tag}`, published: false });
    expect(draft.status).toBe(201);
    await settle();
    expect(await inbox(trekkerA)).toHaveLength(0);

    const live = await request(app).post("/agencies/me/destinations").set(rt()).send({ title: `Manaslu ${tag}`, region: "Gorkha", shortDescription: "A remote circuit", featuredImage: "https://cdn.example.com/m.jpg", published: true });
    expect(live.status).toBe(201);
    await settle();
    const a = await inbox(trekkerA);
    expect(a).toHaveLength(1);
    expect(a[0].title).toMatch(new RegExp(`New destination from .*: Manaslu ${tag}`));
    expect(a[0].body).toBe("A remote circuit");
    expect((a[0].data as { type: string }).type).toBe("NEW_DESTINATION");
    expect(await inbox(trekkerB)).toHaveLength(1);
    expect(await inbox(stranger)).toHaveLength(0);

    // publishing the earlier draft later announces it then
    await request(app).patch(`/agencies/me/destinations/${draft.body.data.id}`).set(rt()).send({ published: true, shortDescription: "A quiet valley", featuredImage: "https://cdn.example.com/d.jpg" });
    await settle();
    expect(await inbox(trekkerA)).toHaveLength(2);
    // unpublish + publish again, or any later edit: no repeat
    await request(app).patch(`/agencies/me/destinations/${live.body.data.id}`).set(rt()).send({ published: false });
    await request(app).patch(`/agencies/me/destinations/${live.body.data.id}`).set(rt()).send({ published: true, region: "Gorkha, Nepal" });
    await settle();
    expect(await inbox(trekkerA)).toHaveLength(2);
  });

  it("a customer the agency removed from its list is not notified", async () => {
    await request(app).delete(`/agencies/me/customers/${trekkerB}`).set(rt());
    const before = (await inbox(trekkerB)).length;
    await request(app).post("/agencies/me/destinations").set(rt()).send({ title: `Annapurna ${tag}`, shortDescription: "Circuit", featuredImage: "https://cdn.example.com/a.jpg", published: true });
    await settle();
    expect((await inbox(trekkerB)).length).toBe(before);
    expect((await inbox(trekkerA)).length).toBe(3);
  });
});
