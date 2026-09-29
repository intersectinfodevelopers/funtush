// Trekker profile (own record only) and the public review form.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { db } from "@funtush/database";
import { generateAccessToken, hashPassword } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("trekker area (e2e)", () => {
  let ctx: E2EContext;
  let userId: string;
  let otherUserId: string;
  let trekkerId: string;
  let bookingId: string;
  const tag = Date.now().toString().slice(-6);

  const tokenFor = (id: string) => generateAccessToken({ userId: id, roleType: "TREKKER", role: "TREKKER" } as Parameters<typeof generateAccessToken>[0]);

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const mk = async (n: string) => {
      const email = `${n}-${tag}@example.com`;
      const u = await db.user.create({ data: { email, normalizedEmail: email, passwordHash: await hashPassword("Str0ngPassw0rd!"), role: "STAFF", roleType: "TREKKER" } });
      const t = await db.trekker.create({ data: { userId: u.id } });
      return { u, t };
    };
    const a = await mk("ta");
    const b = await mk("tb");
    userId = a.u.id;
    trekkerId = a.t.id;
    otherUserId = b.u.id;
    const s = await seedPackage(ctx.agencyId);
    const booking = await db.booking.create({ data: { agencyId: ctx.agencyId, packageId: s.packageId, departureDateId: s.departureDateId, groupSize: 1, totalPrice: 100, status: "COMPLETED", trekkerName: "TA", trekkerEmail: `ta-${tag}@example.com`, trekkerPhone: "9800000000", trekkerId } as never });
    bookingId = booking.id;
  });
  afterAll(async () => {
    await db.review.deleteMany({ where: { agencyId: ctx?.agencyId } });
    await db.reviewInvitation.deleteMany({ where: { bookingId } }).catch(() => undefined);
    await db.booking.deleteMany({ where: { agencyId: ctx?.agencyId } });
    await db.trekker.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await db.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await ctx?.cleanup();
  });

  const get = (t: string) => request(app).get("/trekker/me").set("Authorization", `Bearer ${t}`);
  const patch = (t: string, b: object) => request(app).patch("/trekker/me").set("Authorization", `Bearer ${t}`).send(b);

  it("returns and updates only the signed-in trekker's own profile", async () => {
    const r = await get(tokenFor(userId));
    expect(r.status).toBe(200);
    expect(r.body.data.email).toBe(`ta-${tag}@example.com`);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash/);
    const u = await patch(tokenFor(userId), { fullName: "Maya Rai", phone: "+977 9800000000", country: "Nepal", emergencyContactName: "Sita Rai", emergencyContactPhone: "9811111111" });
    expect(u.status).toBe(200);
    expect(u.body.data.fullName).toBe("Maya Rai");
    // the other trekker is untouched
    expect((await get(tokenFor(otherUserId))).body.data.fullName).toBeNull();
  });

  it("rejects bad values, unknown fields (no mass assignment) and non-trekker tokens", async () => {
    for (const b of [{ fullName: "x" }, { fullName: "<b>" }, { phone: "abc" }, { userId: "x" }, { isActive: false }, { emergencyContactPhone: 5 }]) {
      expect((await patch(tokenFor(userId), b)).status, JSON.stringify(b)).toBe(400);
    }
    expect((await request(app).get("/trekker/me")).status).toBe(401);
    expect((await get(ctx.accessToken)).status).toBe(403);
  });

  it("review form: validates first, then accepts once, then refuses the used token", async () => {
    const token = crypto.randomBytes(16).toString("hex");
    await db.reviewInvitation.create({ data: { bookingId, token, expiresAt: new Date(Date.now() + 60_000) } });
    const post = (b: Record<string, string>) => { const r = request(app).post("/reviews"); for (const [k, v] of Object.entries(b)) r.field(k, v); return r; };
    expect((await post({ token, rating: "9", text: "Great trek" })).status).toBe(400);
    expect((await post({ token, rating: "5", text: "x" })).status).toBe(400);
    expect((await post({ token: "nope".repeat(8), rating: "5", text: "Great trek" })).status).toBe(400);
    const ok = await post({ token, rating: "5", text: "Great trek, brilliant guide", title: "Loved it" });
    expect(ok.status).toBe(201);
    const again = await post({ token, rating: "4", text: "Second try" });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already used/);
  });
});
