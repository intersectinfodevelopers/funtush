// Invited staff: can sign in, but only reach what their role grants; default-deny; takes effect immediately.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { hashPassword } from "@funtush/auth";
import { app } from "../../app";
import { requiredPermission } from "../../services/staffAccess.service";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;
const PW = "StaffPassw0rd!";

d("staff access (e2e)", () => {
  let ctx: E2EContext;
  let staffEmail: string;
  let staffUserId: string;
  let staffId: string;
  let roleId: string;
  let refresh = "";
  let access = "";
  const tag = Date.now().toString().slice(-6);

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    staffEmail = `staff-${tag}@example.com`;
    const role = await db.role.create({ data: { agencyId: ctx.agencyId, name: `Ops ${tag}` } });
    roleId = role.id;
    await db.rolePermission.create({ data: { roleId, permissionKey: "packages" } as never });
    const user = await db.user.create({ data: { email: staffEmail, normalizedEmail: staffEmail, passwordHash: await hashPassword(PW), role: "STAFF", roleType: "TENANT" } });
    staffUserId = user.id;
    const au = await db.agencyUser.create({ data: { agencyId: ctx.agencyId, userId: user.id, role: "STAFF" } });
    staffId = (await db.agencyStaff.create({ data: { agencyId: ctx.agencyId, userId: au.id, roleId, name: "Sam Staff", isActive: true } })).id;
  });
  afterAll(async () => {
    await db.agencyStaff.deleteMany({ where: { agencyId: ctx?.agencyId } });
    await db.agencyUser.deleteMany({ where: { userId: staffUserId } });
    await db.refreshToken.deleteMany({ where: { userId: staffUserId } });
    await db.user.deleteMany({ where: { id: staffUserId } });
    await db.rolePermission.deleteMany({ where: { roleId } });
    await db.role.deleteMany({ where: { id: roleId } });
    await ctx?.cleanup();
  });
  const rt = () => ({ "x-refresh-token": refresh });
  const bearer = () => ({ Authorization: `Bearer ${access}` });

  it("maps routes to permissions and denies anything unmapped", () => {
    expect(requiredPermission("/agencies/packages/abc")).toBe("packages");
    expect(requiredPermission("/agencies/me/finance/pnl")).toBe("finance");
    expect(requiredPermission("/agencies/me/dashboard")).toBe("any");
    expect(requiredPermission("/agencies/me/payment-methods")).toBe("admin");
    expect(requiredPermission("/agencies/me/staff")).toBe("staff");
    expect(requiredPermission("/agencies/me/roles/x/permissions")).toBe("staff");
    expect(requiredPermission("/agencies/me/some-new-route")).toBe("admin");
  });

  it("a wrong password is refused; the right one signs the staff member in", async () => {
    expect((await request(app).post("/auth/agency/login").send({ email: staffEmail, password: "WrongPassw0rd!" })).status).not.toBe(200);
    const r = await request(app).post("/auth/agency/login").send({ email: staffEmail, password: PW });
    expect(r.status).toBe(200);
    refresh = r.body.refreshToken;
    access = r.body.accessToken;
  });

  it("reaches only what the role grants", async () => {
    expect((await request(app).get("/agencies/me/dashboard").set(rt())).status).toBe(200);
    expect((await request(app).get("/agencies/packages").set(rt())).status).toBe(200);
    for (const p of ["/agencies/me/finance/pnl", "/agencies/me/analytics", "/agencies/me/customers", "/agencies/me/guides", "/agencies/me/branding"]) {
      expect((await request(app).get(p).set(rt())).status, p).toBe(403);
    }
    const a = await request(app).get("/agencies/me/access").set(rt());
    expect(a.body.data).toEqual({ role: "STAFF", admin: false, permissions: ["packages"] });
  });

  it("never reaches owner-only areas, and cannot grant itself more", async () => {
    for (const [m, p] of [["get", "/agencies/me/staff"], ["get", "/agencies/me/roles"], ["patch", `/agencies/me/roles/${roleId}/permissions`], ["post", "/agencies/me/payment-methods"], ["get", "/agencies/me/api-keys"], ["post", "/agencies/me/publish"], ["get", "/agencies/me/ad-campaigns"]] as const) {
      const r = await request(app)[m](p).set(rt()).set(bearer()).send({}); // the real client sends both credentials
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });

  it("bookings (Bearer routes) need the bookings permission — and a role change bites immediately", async () => {
    expect((await request(app).get("/bookings").set(bearer())).status).toBe(403);
    await db.rolePermission.create({ data: { roleId, permissionKey: "bookings" } as never });
    expect((await request(app).get("/bookings").set(bearer())).status).toBe(200);
    await db.rolePermission.deleteMany({ where: { roleId, permissionKey: "bookings" } });
    expect((await request(app).get("/bookings").set(bearer())).status).toBe(403);
  });

  it("the `staff` permission manages the team but cannot be used to climb", async () => {
    await db.rolePermission.create({ data: { roleId, permissionKey: "staff" } as never });
    const hi = await db.role.create({ data: { agencyId: ctx.agencyId, name: `Finance ${tag}` } });
    await db.rolePermission.create({ data: { roleId: hi.id, permissionKey: "finance" } as never });
    try {
      const h = () => ({ ...rt(), ...bearer() });
      expect((await request(app).get("/agencies/me/staff").set(h())).status).toBe(200);
      expect((await request(app).get("/agencies/me/roles").set(h())).status).toBe(200);
      expect((await request(app).get("/agencies/me/payment-methods").set(h())).status).toBe(403); // still owner-only

      const low = await request(app).post("/agencies/me/roles").set(h()).send({ name: `Low ${tag}` });
      expect(low.status).toBe(201);
      const lowId = low.body.data.id;
      expect((await request(app).patch(`/agencies/me/roles/${lowId}/permissions`).set(h()).send({ permissionKeys: ["packages"] })).status).toBe(200);
      // can't grant what it doesn't hold, can't edit a higher role or its own role
      expect((await request(app).patch(`/agencies/me/roles/${lowId}/permissions`).set(h()).send({ permissionKeys: ["finance"] })).status).toBe(403);
      expect((await request(app).patch(`/agencies/me/roles/${hi.id}/permissions`).set(h()).send({ permissionKeys: [] })).status).toBe(403);
      expect((await request(app).delete(`/agencies/me/roles/${hi.id}`).set(h())).status).toBe(403);
      expect((await request(app).patch(`/agencies/me/roles/${roleId}/permissions`).set(h()).send({ permissionKeys: ["packages", "staff", "finance"] })).status).toBe(403);
      // inviting: only into roles it fully holds
      expect((await request(app).post("/agencies/me/staff").set(h()).send({ email: `hi-${tag}@example.com`, roleId: hi.id })).status).toBe(403);
      const ok = await request(app).post("/agencies/me/staff").set(h()).send({ email: `lo-${tag}@example.com`, roleId: lowId });
      expect(ok.status).toBe(201);
      // can't touch itself, but can deactivate the lower-level person it invited
      expect((await request(app).delete(`/agencies/me/staff/${staffId}`).set(h())).status).toBe(403);
      expect((await request(app).patch(`/agencies/me/staff/${staffId}/role`).set(h()).send({ roleId: hi.id })).status).toBe(403);
      expect((await request(app).delete(`/agencies/me/staff/${ok.body.staff.id}`).set(h())).status).toBe(200);
      const newUser = await db.user.findUnique({ where: { normalizedEmail: `lo-${tag}@example.com` } });
      if (newUser) { await db.agencyStaff.deleteMany({ where: { agencyUser: { userId: newUser.id } } as never }).catch(() => undefined); }
    } finally {
      await db.agencyStaff.deleteMany({ where: { roleId: hi.id } });
      await db.rolePermission.deleteMany({ where: { roleId: hi.id } });
      await db.role.deleteMany({ where: { id: hi.id } });
      await db.rolePermission.deleteMany({ where: { roleId, permissionKey: "staff" } });
    }
  });

  it("the owner is unaffected", async () => {
    expect((await request(app).get("/agencies/me/finance/pnl").set({ "x-refresh-token": ctx.refreshToken })).status).toBe(200);
    expect((await request(app).get("/agencies/me/access").set({ "x-refresh-token": ctx.refreshToken })).body.data.admin).toBe(true);
  });

  it("deactivating the staff member ends access at once and blocks a new login", async () => {
    await db.agencyStaff.update({ where: { id: staffId }, data: { isActive: false } });
    expect((await request(app).get("/agencies/packages").set(rt())).status).toBe(401);
    expect((await request(app).get("/bookings").set(bearer())).status).toBe(401);
    expect((await request(app).post("/auth/agency/login").send({ email: staffEmail, password: PW })).status).not.toBe(200);
  });
});
