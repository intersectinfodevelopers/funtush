// Trekker email verification: the code is actually emailed, for mixed-case addresses too.
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";

const sent = vi.hoisted(() => ({ otps: [] as { to: string; otp: string }[] }));
vi.mock("../../utils/email", async () => {
  const actual = await vi.importActual<typeof import("../../utils/email")>("../../utils/email");
  return { ...actual, sendOtpEmail: async (to: string, otp: string) => void sent.otps.push({ to, otp }) };
});

import { app } from "../../app";
import { dbAvailable } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;
const email = `MixedCase-${Date.now().toString().slice(-6)}@Example.com`;

d("trekker OTP delivery (e2e)", () => {
  afterAll(async () => {
    const u = await db.user.findFirst({ where: { email }, select: { id: true } });
    if (u) { await db.trekker.deleteMany({ where: { userId: u.id } }); await db.user.delete({ where: { id: u.id } }); }
  });

  it("emails a code on registration, and it verifies the account", async () => {
    const reg = await request(app).post("/auth/register").send({ email, password: "Str0ngPassw0rd!", confirmPassword: "Str0ngPassw0rd!" });
    expect(reg.status).toBe(201);
    await new Promise((r) => setTimeout(r, 300));
    expect(sent.otps.length).toBe(1);
    expect(sent.otps[0].to).toBe(email.toLowerCase());
    const ok = await request(app).post("/auth/verify-otp").send({ userId: reg.body.userId, otp: sent.otps[0].otp });
    expect(ok.status).toBe(200);
    const t = await db.trekker.findUnique({ where: { id: reg.body.userId }, select: { isEmailVerified: true } });
    expect(t?.isEmailVerified).toBe(true);
  });

  it("resend emails a fresh code; an unknown address gets the same reply and no email", async () => {
    const before = sent.otps.length;
    const r = await request(app).post("/auth/trekker/resend-otp").send({ email });
    expect(r.status).toBe(200);
    expect(sent.otps.length).toBe(before + 1);
    const u = await request(app).post("/auth/trekker/resend-otp").send({ email: `nobody-${Date.now()}@example.com` });
    expect(u.status).toBe(200);
    expect(u.body).toEqual(r.body);
    expect(sent.otps.length).toBe(before + 1);
  });
});
