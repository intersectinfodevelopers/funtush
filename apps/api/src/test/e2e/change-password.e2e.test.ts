// Signed-in password change: needs the current password, strong new one, ends all sessions.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { hashPassword, generateAccessToken } from "@funtush/auth";

vi.mock("../../utils/email", async () => {
  const actual = await vi.importActual<typeof import("../../utils/email")>("../../utils/email");
  return { ...actual, sendPasswordChangedEmail: async () => undefined };
});

import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;
const OLD = "OldPassw0rd!";
const NEW = "BrandNewPassw0rd!";

d("POST /auth/change-password (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    await db.user.update({ where: { id: ctx.userId }, data: { passwordHash: await hashPassword(OLD) } });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const call = (body: object, token = ctx.accessToken) => request(app).post("/auth/change-password").set("Authorization", `Bearer ${token}`).send(body);

  it("requires a session", async () => {
    expect((await request(app).post("/auth/change-password").send({})).status).toBe(401);
  });

  it("rejects a wrong current password, a weak new one, and reusing the current one", async () => {
    expect((await call({ currentPassword: "wrong", newPassword: NEW })).status).toBe(400);
    expect((await call({ currentPassword: OLD, newPassword: "weak" })).status).toBe(400);
    expect((await call({ currentPassword: OLD, newPassword: OLD })).status).toBe(400);
    expect((await call({ newPassword: NEW })).status).toBe(400);
  });

  it("refuses to run inside a support (impersonation) session", async () => {
    const t = generateAccessToken({ userId: ctx.userId, roleType: "TENANT", role: "AGENCY_ADMIN", agencyId: ctx.agencyId, impersonatedBy: "admin-1" } as Parameters<typeof generateAccessToken>[0]);
    expect((await call({ currentPassword: OLD, newPassword: NEW }, t)).status).toBe(403);
  });

  it("changes the password and ends every session", async () => {
    const r = await call({ currentPassword: OLD, newPassword: NEW });
    expect(r.status).toBe(200);
    const u = await db.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
    const oldLogin = await request(app).post("/auth/agency/login").send({ email: u!.email, password: OLD });
    const newLogin = await request(app).post("/auth/agency/login").send({ email: u!.email, password: NEW });
    expect(oldLogin.status).not.toBe(200);
    expect(newLogin.status).toBe(200);
  });
});
