// ─────────────────────────────────────────────────────────────────────────────
// Auth — end-to-end (API-wide docs/test pass, Batch 2). Security-critical and
// previously had zero dedicated tests at all. Drives the real app + real DB
// (Postgres for users/refresh tokens, Redis for OTP/lockout state).
//
// Found and fixed along the way (see auth.routes.ts / auth.validation.ts):
//   - `export default router` sat before 4 more routes were registered on
//     it — harmless under ESM evaluation order, but a landmine for the next
//     edit. Moved to the real end of the file.
//   - `registerSchema`/`verifyOtpSchema` existed but were never wired into
//     their routes — `/register` accepted any password with no complexity
//     check, `/verify-otp` accepted a malformed body. Both now validated.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { hashPassword, generateAccessToken, generateRefreshToken, storeOTP, hashToken } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const PASSWORD = "Str0ngPassw0rd!";

d("Auth (e2e)", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db.refreshToken.deleteMany({ where: { userId: id } }).catch(() => {});
      await db.trekker.deleteMany({ where: { userId: id } }).catch(() => {});
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function createUser(overrides: { role: "SUPER_ADMIN" | "AGENCY_ADMIN" | "STAFF"; roleType: "PLATFORM" | "TENANT" | "TREKKER"; email: string }) {
    const user = await db.user.create({
      data: {
        email: overrides.email,
        passwordHash: await hashPassword(PASSWORD),
        role: overrides.role,
        roleType: overrides.roleType,
      },
      select: { id: true, email: true },
    });
    createdUserIds.push(user.id);
    return user;
  }

  function uniqueEmail(label: string) {
    return `auth-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  }

  /* ── POST /auth/admin/login ─────────────────────────────────────────── */

  describe("POST /auth/admin/login", () => {
    it("rejects malformed input with 400", async () => {
      const res = await request(app).post("/auth/admin/login").send({ email: "not-an-email", password: "x" });
      expect(res.status).toBe(400);
    });

    it("logs in a SUPER_ADMIN user and issues both tokens", async () => {
      const email = uniqueEmail("admin");
      await createUser({ role: "SUPER_ADMIN", roleType: "PLATFORM", email });

      const res = await request(app).post("/auth/admin/login").send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
    });

    it("rejects a non-SUPER_ADMIN user with 401", async () => {
      const email = uniqueEmail("notadmin");
      await createUser({ role: "STAFF", roleType: "TENANT", email });

      const res = await request(app).post("/auth/admin/login").send({ email, password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it("rejects the wrong password with 401", async () => {
      const email = uniqueEmail("wrongpw");
      await createUser({ role: "SUPER_ADMIN", roleType: "PLATFORM", email });

      const res = await request(app).post("/auth/admin/login").send({ email, password: "totally-wrong-password" });
      expect(res.status).toBe(401);
    });

    it("locks the account after 5 failed attempts, then 429s", async () => {
      const email = uniqueEmail("lockout");
      await createUser({ role: "SUPER_ADMIN", roleType: "PLATFORM", email });

      for (let i = 0; i < 5; i++) {
        await request(app).post("/auth/admin/login").send({ email, password: "wrong-password" });
      }

      const res = await request(app).post("/auth/admin/login").send({ email, password: PASSWORD });
      expect(res.status).toBe(429);
    });
  });

  /* ── POST /auth/agency/login ─────────────────────────────────────────── */

  describe("POST /auth/agency/login", () => {
    let agencyId: string;
    let tierId: string;

    beforeAll(async () => {
      const s = `${Date.now()}`;
      const tier = await db.subscriptionTier.upsert({
        where: { name: "AUTH_E2E_TIER" },
        update: {},
        create: { name: "AUTH_E2E_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
        select: { id: true },
      });
      tierId = tier.id;
      const agency = await db.agency.create({
        data: { name: `Auth E2E ${s}`, email: `auth-e2e-agency-${s}@example.com`, slug: `auth-e2e-${s}`, tierId },
        select: { id: true },
      });
      agencyId = agency.id;
    });

    afterAll(async () => {
      if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
    });

    it("logs in an AGENCY_ADMIN user linked to an active agency", async () => {
      const email = uniqueEmail("agency");
      const user = await createUser({ role: "AGENCY_ADMIN", roleType: "TENANT", email });
      await db.agencyUser.create({ data: { agencyId, userId: user.id, role: "AGENCY_ADMIN" } });

      const res = await request(app).post("/auth/agency/login").send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
    });

    it("rejects an AGENCY_ADMIN with no linked agency", async () => {
      const email = uniqueEmail("orphan");
      await createUser({ role: "AGENCY_ADMIN", roleType: "TENANT", email });

      const res = await request(app).post("/auth/agency/login").send({ email, password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it("rejects login for a SUSPENDED agency", async () => {
      const email = uniqueEmail("suspended");
      const user = await createUser({ role: "AGENCY_ADMIN", roleType: "TENANT", email });
      await db.agencyUser.create({ data: { agencyId, userId: user.id, role: "AGENCY_ADMIN" } });
      await db.agency.update({ where: { id: agencyId }, data: { status: "SUSPENDED" } });

      const res = await request(app).post("/auth/agency/login").send({ email, password: PASSWORD });
      expect(res.status).toBe(401);

      await db.agency.update({ where: { id: agencyId }, data: { status: "ACTIVE" } });
    });
  });

  /* ── POST /auth/trekker/login ─────────────────────────────────────────── */

  describe("POST /auth/trekker/login", () => {
    it("logs in a trekker", async () => {
      const email = uniqueEmail("trekker");
      const user = await createUser({ role: "STAFF", roleType: "TREKKER", email });
      await db.trekker.create({ data: { userId: user.id } });

      const res = await request(app).post("/auth/trekker/login").send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
    });

    it("rejects a user with no trekker profile", async () => {
      const email = uniqueEmail("notrekker");
      await createUser({ role: "STAFF", roleType: "TREKKER", email });

      const res = await request(app).post("/auth/trekker/login").send({ email, password: PASSWORD });
      expect(res.status).toBe(401);
    });
  });

  /* ── POST /auth/register ─────────────────────────────────────────────── */

  describe("POST /auth/register", () => {
    it("rejects a weak password with 400 (registerSchema, now wired in)", async () => {
      const res = await request(app)
        .post("/auth/register")
        .send({ email: uniqueEmail("weak"), password: "weak", confirmPassword: "weak" });
      expect(res.status).toBe(400);
    });

    it("rejects a mismatched confirmPassword with 400", async () => {
      const res = await request(app).post("/auth/register").send({
        email: uniqueEmail("mismatch"),
        password: "Str0ngPassw0rd!",
        confirmPassword: "Different1!",
      });
      expect(res.status).toBe(400);
    });

    it("registers a new trekker", async () => {
      const email = uniqueEmail("newreg");
      const res = await request(app)
        .post("/auth/register")
        .send({ email, password: "Str0ngPassw0rd!", confirmPassword: "Str0ngPassw0rd!" });

      expect(res.status).toBe(201);
      const created = await db.user.findUnique({ where: { email } });
      expect(created).not.toBeNull();
      if (created) createdUserIds.push(created.id);
    });

    it("rejects a duplicate email with 400", async () => {
      const email = uniqueEmail("dupe");
      await createUser({ role: "STAFF", roleType: "TREKKER", email });

      const res = await request(app)
        .post("/auth/register")
        .send({ email, password: "Str0ngPassw0rd!", confirmPassword: "Str0ngPassw0rd!" });
      expect(res.status).toBe(400);
    });
  });

  /* ── POST /auth/verify-otp ────────────────────────────────────────────── */

  describe("POST /auth/verify-otp", () => {
    it("rejects a malformed body with 400 (verifyOtpSchema, now wired in)", async () => {
      const res = await request(app).post("/auth/verify-otp").send({ userId: "x", otp: "12" });
      expect(res.status).toBe(400);
    });

    it("rejects the wrong code with 400", async () => {
      const email = uniqueEmail("otpwrong");
      const user = await createUser({ role: "STAFF", roleType: "TREKKER", email });
      const trekker = await db.trekker.create({ data: { userId: user.id } });
      await storeOTP(email, "111111");

      const res = await request(app).post("/auth/verify-otp").send({ userId: trekker.id, otp: "222222" });
      expect(res.status).toBe(400);
    });

    it("verifies a correct code and marks the trekker's email verified", async () => {
      const email = uniqueEmail("otpright");
      const user = await createUser({ role: "STAFF", roleType: "TREKKER", email });
      const trekker = await db.trekker.create({ data: { userId: user.id } });
      await storeOTP(email, "654321");

      const res = await request(app).post("/auth/verify-otp").send({ userId: trekker.id, otp: "654321" });
      expect(res.status).toBe(200);

      const updated = await db.trekker.findUnique({ where: { id: trekker.id } });
      expect(updated?.isEmailVerified).toBe(true);
    });
  });

  /* ── GET /auth/me ─────────────────────────────────────────────────────── */

  describe("GET /auth/me", () => {
    it("401s without a bearer token", async () => {
      const res = await request(app).get("/auth/me");
      expect(res.status).toBe(401);
    });

    it("returns the caller's identity for a valid access token", async () => {
      const token = generateAccessToken({ userId: "some-user-id", roleType: "TENANT", role: "AGENCY_ADMIN", agencyId: "agency-x" });
      const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.userId).toBe("some-user-id");
      expect(res.body.user.agencyId).toBe("agency-x");
    });
  });

  /* ── POST /auth/refresh ───────────────────────────────────────────────── */

  describe("POST /auth/refresh", () => {
    it("rejects an invalid refresh token with 401", async () => {
      const res = await request(app).post("/auth/refresh").send({ refreshToken: "not-a-real-jwt" });
      expect(res.status).toBe(401);
    });

    it("issues a new token pair, consuming the old refresh token's DB row", async () => {
      const email = uniqueEmail("refresh");
      const user = await createUser({ role: "STAFF", roleType: "TREKKER", email });
      await db.trekker.create({ data: { userId: user.id } });

      const refreshToken = generateRefreshToken(user.id);
      await db.refreshToken.create({
        data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 86400000) },
      });

      const res = await request(app).post("/auth/refresh").send({ refreshToken });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();

      // `refreshTokenService` deletes the presented token's row and creates
      // exactly one new one — asserted via a DB count rather than "the new
      // JWT string differs from the old one" (that would be flaky:
      // `generateRefreshToken` signs `{userId}` with second-resolution
      // `iat`, so two calls in the same wall-clock second produce
      // byte-identical tokens — not a security issue for real, distinct
      // login sessions, just not a safe thing to assert on in a fast test).
      const rows = await db.refreshToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
    });
  });

  /* ── POST /auth/logout ───────────────────────────────────────────────── */

  describe("POST /auth/logout", () => {
    it("deletes the refresh token and reports success", async () => {
      const email = uniqueEmail("logout");
      const user = await createUser({ role: "STAFF", roleType: "TREKKER", email });
      const refreshToken = generateRefreshToken(user.id);
      const tokenHash = hashToken(refreshToken);
      await db.refreshToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 86400000) },
      });

      const res = await request(app).post("/auth/logout").send({ refreshToken });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const remaining = await db.refreshToken.findUnique({ where: { tokenHash } });
      expect(remaining).toBeNull();
    });
  });

  /* ── POST /auth/trekker/resend-otp ───────────────────────────────────── */

  describe("POST /auth/trekker/resend-otp", () => {
    it("sends a new OTP for a known email", async () => {
      const email = uniqueEmail("resend");
      await createUser({ role: "STAFF", roleType: "TREKKER", email });

      const res = await request(app).post("/auth/trekker/resend-otp").send({ email });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  /* ── POST /auth/fcm-token ─────────────────────────────────────────────── */

  describe("POST /auth/fcm-token", () => {
    it("401s without a bearer token", async () => {
      const res = await request(app).post("/auth/fcm-token").send({ fcmToken: "x" });
      expect(res.status).toBe(401);
    });

    it("requires fcmToken in the body", async () => {
      const email = uniqueEmail("fcm-empty");
      const user = await createUser({ role: "STAFF", roleType: "TREKKER", email });
      const token = generateAccessToken({ userId: user.id, roleType: "TREKKER", role: "STAFF" });

      const res = await request(app).post("/auth/fcm-token").set("Authorization", `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });

    it("registers the FCM token for the authenticated user", async () => {
      const email = uniqueEmail("fcm-ok");
      const user = await createUser({ role: "STAFF", roleType: "TREKKER", email });
      const token = generateAccessToken({ userId: user.id, roleType: "TREKKER", role: "STAFF" });

      const res = await request(app)
        .post("/auth/fcm-token")
        .set("Authorization", `Bearer ${token}`)
        .send({ fcmToken: "fcm-token-value-123" });
      expect(res.status).toBe(200);

      const updated = await db.user.findUnique({ where: { id: user.id } });
      expect(updated?.fcmToken).toBe("fcm-token-value-123");
    });
  });
});
