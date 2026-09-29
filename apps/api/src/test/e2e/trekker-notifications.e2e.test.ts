// In-app trekker notifications: stored even without a push token, private to their owner.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { generateAccessToken, hashPassword } from "@funtush/auth";
import { app } from "../../app";
import { notifyTrekker } from "../../services/notification.service";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("trekker notifications (e2e)", () => {
  const tag = Date.now().toString().slice(-6);
  const users: string[] = [];
  let a: { userId: string; trekkerId: string };
  let b: { userId: string; trekkerId: string };
  let ctx: E2EContext;
  const tok = (id: string) => generateAccessToken({ userId: id, roleType: "TREKKER", role: "TREKKER" } as Parameters<typeof generateAccessToken>[0]);
  const auth = (id: string) => ({ Authorization: `Bearer ${tok(id)}` });

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const mk = async (n: string) => {
      const email = `${n}-${tag}@example.com`;
      const u = await db.user.create({ data: { email, normalizedEmail: email, passwordHash: await hashPassword("Str0ngPassw0rd!"), role: "STAFF", roleType: "TREKKER" } });
      const t = await db.trekker.create({ data: { userId: u.id } });
      users.push(u.id);
      return { userId: u.id, trekkerId: t.id };
    };
    a = await mk("na");
    b = await mk("nb");
  });
  afterAll(async () => {
    await db.trekker.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await ctx?.cleanup();
  });

  it("stores a notification even though the trekker has no push token", async () => {
    await notifyTrekker(a.trekkerId, { title: "Booking confirmed", body: "Your trek is confirmed", data: { bookingId: "b1" } });
    await notifyTrekker(a.trekkerId, { title: "Payment received", body: "Thanks!" });
    const r = await request(app).get("/trekker/notifications").set(auth(a.userId));
    expect(r.status).toBe(200);
    expect(r.body.data.unread).toBe(2);
    expect(r.body.data.items.map((n: { title: string }) => n.title)).toEqual(["Payment received", "Booking confirmed"]);
    expect(r.body.data.items[1].data).toEqual({ bookingId: "b1" });
    expect((await request(app).get("/trekker/notifications/unread-count").set(auth(a.userId))).body.data.unread).toBe(2);
  });

  it("is private: another trekker sees none and cannot mark them read", async () => {
    expect((await request(app).get("/trekker/notifications").set(auth(b.userId))).body.data.items).toEqual([]);
    const ids = (await request(app).get("/trekker/notifications").set(auth(a.userId))).body.data.items.map((n: { id: string }) => n.id);
    const r = await request(app).post("/trekker/notifications/read").set(auth(b.userId)).send({ ids });
    expect(r.body.data.updated).toBe(0);
    expect((await request(app).get("/trekker/notifications/unread-count").set(auth(a.userId))).body.data.unread).toBe(2);
  });

  it("marks one, then all, as read; rejects a bad ids value; needs a trekker session", async () => {
    const items = (await request(app).get("/trekker/notifications").set(auth(a.userId))).body.data.items;
    expect((await request(app).post("/trekker/notifications/read").set(auth(a.userId)).send({ ids: [items[0].id] })).body.data.updated).toBe(1);
    expect((await request(app).get("/trekker/notifications/unread-count").set(auth(a.userId))).body.data.unread).toBe(1);
    expect((await request(app).post("/trekker/notifications/read").set(auth(a.userId)).send({ ids: "all" })).status).toBe(400);
    expect((await request(app).post("/trekker/notifications/read").set(auth(a.userId)).send({})).body.data.updated).toBe(1);
    expect((await request(app).get("/trekker/notifications/unread-count").set(auth(a.userId))).body.data.unread).toBe(0);
    expect((await request(app).get("/trekker/notifications")).status).toBe(401);
    expect((await request(app).get("/trekker/notifications").set("Authorization", `Bearer ${ctx.accessToken}`)).status).toBe(403);
  });
});
