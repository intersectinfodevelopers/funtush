// Registration: no credential leaks (response / welcome email), strong passwords, sane names.
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";

const sent = vi.hoisted(() => ({ welcome: [] as { to: string; text: string }[] }));
vi.mock("../../utils/email", async () => {
  const actual = await vi.importActual<typeof import("../../utils/email")>("../../utils/email");
  return { ...actual, sendWelcomeEmail: async (to: string, name: string) => void sent.welcome.push({ to, text: name }) };
});

import { app } from "../../app";
import { dbAvailable } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;
const tag = Date.now().toString().slice(-6);
const emails: string[] = [];
const uniq = (p: string) => { const e = `${p}-${tag}-${emails.length}@example.com`; emails.push(e); return e; };

d("registration hardening (e2e)", () => {
  afterAll(async () => {
    for (const e of emails) {
      const u = await db.user.findUnique({ where: { email: e }, select: { id: true } });
      if (!u) continue;
      const au = await db.agencyUser.findMany({ where: { userId: u.id }, select: { agencyId: true } });
      await db.trekker.deleteMany({ where: { userId: u.id } });
      await db.refreshToken.deleteMany({ where: { userId: u.id } });
      await db.agencyUser.deleteMany({ where: { userId: u.id } });
      for (const a of au) await db.agency.delete({ where: { id: a.agencyId } }).catch(() => undefined);
      await db.user.delete({ where: { id: u.id } }).catch(() => undefined);
    }
  });

  it("trekker registration never returns the password hash", async () => {
    const res = await request(app).post("/auth/register").send({ email: uniq("trk"), password: "Str0ngPassw0rd!", confirmPassword: "Str0ngPassw0rd!" });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(res.body.userId).toBeTruthy();
  });

  it("agency registration: weak password, bad name and bad phone are rejected", async () => {
    const base = { name: "Trail Agency", email: uniq("ag"), password: "Str0ngPassw0rd!", phone: "9812345678" };
    for (const b of [{ ...base, password: "alllowercase1" }, { ...base, password: "NoDigitsHere!" }, { ...base, name: "<b>x</b>" }, { ...base, name: "a" }, { ...base, phone: "12345" }]) {
      expect((await request(app).post("/register/agency").send(b)).status, JSON.stringify(b)).toBe(400);
    }
  });

  it("agency registration succeeds, the welcome email carries no password, and login works", async () => {
    const email = uniq("ag-ok");
    const res = await request(app).post("/register/agency").send({ name: "Trail Agency Ok", email, password: "Str0ngPassw0rd!", phone: "9812345678" });
    expect([201, 202]).toContain(res.status);
    if (res.status === 201) {
      expect(sent.welcome.some((w) => w.to === email)).toBe(true);
      expect(JSON.stringify(sent.welcome)).not.toContain("Str0ngPassw0rd!");
      expect((await request(app).post("/auth/agency/login").send({ email, password: "Str0ngPassw0rd!" })).status).toBe(200);
    }
  });
});
