// ─────────────────────────────────────────────────────────────────────────────
// Password recovery — end-to-end: self-service "Forgot password" and the
// admin-issued break-glass code, against the real app + docker-compose.test.yml.
// Emails are captured (not sent) so the reset link / notifications can be
// asserted. Skips cleanly when the test infra is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { generateAccessToken, hashPassword, hashToken } from "@funtush/auth";
import { normalizeEmail } from "@funtush/shared";

const sent = vi.hoisted(() => ({
  resetLinks: [] as { to: string; url: string }[],
  changed: [] as { to: string; how: string }[],
  breakGlass: [] as { to: string; reason: string }[],
}));

vi.mock("../../utils/email", async () => {
  const actual = await vi.importActual<typeof import("../../utils/email")>("../../utils/email");
  return {
    ...actual,
    sendPasswordResetEmail: async (to: string, url: string) => void sent.resetLinks.push({ to, url }),
    sendPasswordChangedEmail: async (to: string, how: string) => void sent.changed.push({ to, how }),
    sendBreakGlassIssuedEmail: async (to: string, _n: string, reason: string) => void sent.breakGlass.push({ to, reason }),
  };
});

import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const OLD_PW = "OldPassw0rd!";
const NEW_PW = "BrandNewPassw0rd!";
const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };
const platformToken = () =>
  generateAccessToken({ userId: "e2e-platform-admin", roleType: "PLATFORM", role: "SUPER_ADMIN" } as Parameters<typeof generateAccessToken>[0]);

const tokenFromUrl = (url: string) => new URL(url).searchParams.get("token")!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("Password recovery (e2e)", () => {
  let ctx: E2EContext;
  let email: string;
  const extraUsers: string[] = [];

  /** The HTTP per-IP limiter (5 logins/min) is separate from the account lockout under test. */
  async function clearHttpRateLimit() {
    const { redis } = await import("../../lib/redis");
    const keys = await redis.keys("ratelimit:*");
    if (keys.length) await redis.del(...keys);
  }
  async function login(password: string) {
    await clearHttpRateLimit();
    return request(app).post("/auth/agency/login").send({ email, password });
  }
  async function resetLinkFor(addr: string) {
    const r = await request(app).post("/auth/forgot-password").send({ email: addr });
    expect(r.status).toBe(200);
    return sent.resetLinks.filter((l) => l.to === addr).at(-1);
  }

  beforeAll(async () => {
    if (!RUN) return;
    // app.ts doesn't connect lib/redis (index.ts does, at boot) — do it here.
    const { redis } = await import("../../lib/redis");
    if (redis.status === "wait") await redis.connect();
    ctx = await createAgencyContext();
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { email: true } });
    email = user.email;
  });

  afterAll(async () => {
    if (!RUN) return;
    await db.user.deleteMany({ where: { id: { in: extraUsers } } }).catch(() => {});
    await ctx?.cleanup();
  });

  beforeEach(async () => {
    sent.resetLinks.length = 0;
    sent.changed.length = 0;
    sent.breakGlass.length = 0;
    // Independent tests: fresh rate-limit budget, unlocked account, known password.
    const { redis } = await import("../../lib/redis");
    for (const pattern of ["pwd-reset:*", "auth:*", `revoked-user:${ctx.userId}`]) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    }
    await db.user.update({ where: { id: ctx.userId }, data: { passwordHash: await hashPassword(OLD_PW) } });
  });

  describe("forgot / reset password", () => {
    it("answers identically for a real and a non-existent account (no enumeration)", async () => {
      const real = await request(app).post("/auth/forgot-password").send({ email });
      const fake = await request(app).post("/auth/forgot-password").send({ email: "nobody-here@example.com" });
      expect(real.status).toBe(200);
      expect(fake.status).toBe(200);
      expect(real.body).toEqual(fake.body);
      expect(sent.resetLinks.map((l) => l.to)).toEqual([email]);
    });

    it("takes the same time for a real and an unknown account (no timing oracle)", async () => {
      const time = async (addr: string) => {
        const t = Date.now();
        await request(app).post("/auth/forgot-password").send({ email: addr });
        return Date.now() - t;
      };
      const real = await time(email);
      const fake = await time("nobody-here@example.com");
      expect(real).toBeGreaterThanOrEqual(240);
      expect(fake).toBeGreaterThanOrEqual(240);
      expect(Math.abs(real - fake)).toBeLessThan(80);
    });

    it("survives malformed input without a 5xx", async () => {
      for (const body of [{}, { email: { $ne: 1 } }, { email: 123 }, { email: ["a@b.c"] }, { email: "x".repeat(400) + "@a.com" }]) {
        const r = await request(app).post("/auth/forgot-password").send(body);
        expect(r.status).toBe(200);
      }
      expect(sent.resetLinks).toHaveLength(0);
    });

    it("stores only a hash — the emailed token is not recoverable from Redis", async () => {
      const link = (await resetLinkFor(email))!;
      const token = tokenFromUrl(link.url);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      const { redis } = await import("../../lib/redis");
      expect(await redis.exists(`pwd-reset:${token}`)).toBe(0);
      expect(await redis.exists(`pwd-reset:${hashToken(token)}`)).toBe(1);
    });

    it("resets the password, once: new password works, old one and the token do not", async () => {
      const token = tokenFromUrl((await resetLinkFor(email))!.url);

      const ok = await request(app).post("/auth/reset-password").send({ token, password: NEW_PW });
      expect(ok.status).toBe(200);
      expect(sent.changed.map((c) => c.to)).toEqual([email]);

      expect((await login(NEW_PW)).status).toBe(200);
      expect((await login(OLD_PW)).status).toBe(401);

      const replay = await request(app).post("/auth/reset-password").send({ token, password: "AnotherPassw0rd!" });
      expect(replay.status).toBe(400);
    });

    it("a weak password is rejected WITHOUT burning the token", async () => {
      const token = tokenFromUrl((await resetLinkFor(email))!.url);
      for (const password of ["short", "alllowercase1", "NOLOWERCASE1", "NoDigitsHere", "x".repeat(80) + "Aa1"]) {
        expect((await request(app).post("/auth/reset-password").send({ token, password })).status).toBe(400);
      }
      expect((await request(app).post("/auth/reset-password").send({ token, password: NEW_PW })).status).toBe(200);
    });

    it("a newer request invalidates the earlier link", async () => {
      const first = tokenFromUrl((await resetLinkFor(email))!.url);
      const second = tokenFromUrl((await resetLinkFor(email))!.url);
      expect(first).not.toBe(second);
      expect((await request(app).post("/auth/reset-password").send({ token: first, password: NEW_PW })).status).toBe(400);
      expect((await request(app).post("/auth/reset-password").send({ token: second, password: NEW_PW })).status).toBe(200);
    });

    it("rejects forged / malformed tokens", async () => {
      for (const token of ["", "abc", "a".repeat(64), { $ne: "x" }, ["a".repeat(64)], null, 12345]) {
        const r = await request(app).post("/auth/reset-password").send({ token, password: NEW_PW });
        expect(r.status).toBe(400);
      }
    });

    it("revokes sessions issued before the reset (the stolen-refresh-token case)", async () => {
      const before = await request(app).get("/agencies/me/kyc").set("x-refresh-token", ctx.refreshToken);
      expect(before.status).not.toBe(401);

      const token = tokenFromUrl((await resetLinkFor(email))!.url);
      await request(app).post("/auth/reset-password").send({ token, password: NEW_PW }).expect(200);

      const after = await request(app).get("/agencies/me/kyc").set("x-refresh-token", ctx.refreshToken);
      expect(after.status).toBe(401);

      // …but a session created afterwards works.
      await sleep(1100);
      const fresh = await login(NEW_PW);
      expect(fresh.status).toBe(200);
      const ok = await request(app).get("/agencies/me/kyc").set("x-refresh-token", fresh.body.refreshToken);
      expect(ok.status).not.toBe(401);
    });

    it("clears a lockout so the owner can sign in straight after resetting", async () => {
      for (let i = 0; i < 5; i++) await login("WrongPassw0rd!");
      const locked = await login(OLD_PW); // even the RIGHT password is refused while locked
      expect(locked.status).toBe(429);
      expect(locked.body.message).toMatch(/temporarily blocked/);

      const token = tokenFromUrl((await resetLinkFor(email))!.url);
      await request(app).post("/auth/reset-password").send({ token, password: NEW_PW }).expect(200);
      expect((await login(NEW_PW)).status).toBe(200);
    });

    it("rate limits reset requests per email (silently — same response, no extra email)", async () => {
      for (let i = 0; i < 6; i++) await request(app).post("/auth/forgot-password").send({ email });
      expect(sent.resetLinks.length).toBe(3);
    });

    it("never offers self-service reset for platform staff", async () => {
      const staffEmail = `e2e-super-${Date.now()}@example.com`;
      const u = await db.user.create({
        data: { email: staffEmail, normalizedEmail: normalizeEmail(staffEmail), passwordHash: "x", role: "SUPER_ADMIN", roleType: "PLATFORM" },
        select: { id: true },
      });
      extraUsers.push(u.id);
      const r = await request(app).post("/auth/forgot-password").send({ email: staffEmail });
      expect(r.status).toBe(200);
      expect(sent.resetLinks).toHaveLength(0);
    });
  });

  describe("break-glass", () => {
    const issue = (body: object = { reason: "Owner lost mailbox; identity verified by phone" }, token = platformToken()) =>
      request(app).post(`/admin/agencies/${ctx.agencyId}/break-glass`).set(adminHeaders).set("Authorization", `Bearer ${token}`).send(body);
    const redeem = (token: unknown, password: unknown = NEW_PW) => request(app).post("/auth/break-glass/redeem").send({ token, password });

    it("cannot be issued without platform-admin credentials", async () => {
      expect((await request(app).post(`/admin/agencies/${ctx.agencyId}/break-glass`).send({ reason: "x" })).status).not.toBe(201);
      expect((await request(app).post(`/admin/agencies/${ctx.agencyId}/break-glass`).set(adminHeaders).send({ reason: "x" })).status).toBe(401);
      const tenant = await issue({ reason: "x" }, ctx.accessToken);
      expect(tenant.status).toBe(403);
    });

    it("requires a reason", async () => {
      for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: 5 }]) {
        expect((await issue(body)).status).toBe(400);
      }
    });

    it("404s for an unknown agency", async () => {
      const r = await request(app).post("/admin/agencies/does-not-exist/break-glass").set(adminHeaders)
        .set("Authorization", `Bearer ${platformToken()}`).send({ reason: "x" });
      expect(r.status).toBe(404);
    });

    it("issues a code, notifies the owner (without the code) and stores only a hash", async () => {
      const r = await issue();
      expect(r.status).toBe(201);
      expect(r.headers["cache-control"]).toContain("no-store");
      expect(r.body.token).toMatch(/^[a-f0-9]{64}$/);
      expect(sent.breakGlass).toEqual([{ to: email, reason: "Owner lost mailbox; identity verified by phone" }]);
      expect(JSON.stringify(sent)).not.toContain(r.body.token);

      const rows = await db.breakGlassToken.findMany({ where: { agencyId: ctx.agencyId } });
      expect(rows.some((row) => row.token === r.body.token)).toBe(false);
      expect(rows.some((row) => row.token === hashToken(r.body.token))).toBe(true);
    });

    it("lets the owner set a new password, exactly once, and revokes old sessions", async () => {
      const { body } = await issue();
      // A weak password doesn't burn the code.
      expect((await redeem(body.token, "weak")).status).toBe(400);

      const ok = await redeem(body.token);
      expect(ok.status).toBe(200);
      expect(sent.changed).toEqual([{ to: email, how: "emergency account recovery" }]);

      expect((await login(NEW_PW)).status).toBe(200);
      expect((await login(OLD_PW)).status).toBe(401);
      expect((await redeem(body.token)).status).toBe(400); // single use
      expect((await request(app).get("/agencies/me/kyc").set("x-refresh-token", ctx.refreshToken)).status).toBe(401);
    });

    it("issuing again supersedes the earlier code", async () => {
      const a = await issue();
      const b = await issue();
      expect((await redeem(a.body.token)).status).toBe(400);
      expect((await redeem(b.body.token)).status).toBe(200);
    });

    it("can be revoked before use", async () => {
      const { body } = await issue();
      const r = await request(app).delete(`/admin/agencies/${ctx.agencyId}/break-glass`).set(adminHeaders).set("Authorization", `Bearer ${platformToken()}`);
      expect(r.status).toBe(200);
      expect(r.body.revoked).toBe(1);
      expect((await redeem(body.token)).status).toBe(400);
    });

    it("expires", async () => {
      const { body } = await issue();
      await db.breakGlassToken.updateMany({ where: { agencyId: ctx.agencyId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await redeem(body.token)).status).toBe(400);
    });

    it("rejects forged / malformed codes and the hash itself", async () => {
      const { body } = await issue();
      for (const t of ["", "a".repeat(64), hashToken(body.token), { $ne: "x" }, null, 1]) {
        expect((await redeem(t)).status).toBe(400);
      }
    });

    it("only one of many concurrent redemptions wins", async () => {
      const { body } = await issue();
      const results = await Promise.all(Array.from({ length: 8 }, () => redeem(body.token)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it("a banned agency cannot be recovered", async () => {
      await db.agency.update({ where: { id: ctx.agencyId }, data: { status: "BANNED" } });
      try {
        expect((await issue()).status).toBe(403);
      } finally {
        await db.agency.update({ where: { id: ctx.agencyId }, data: { status: "ACTIVE" } });
      }
    });
  });
});
