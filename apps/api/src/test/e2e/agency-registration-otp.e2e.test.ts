// ─────────────────────────────────────────────────────────────────────────────
// Agency registration — the admin-controlled phone-OTP toggle (PATCH
// /admin/settings agencyPhoneOtpRequired) and its effect on
// POST /register/agency + POST /register/agency/verify-otp.
//
// Skips cleanly when the docker-compose.test.yml DB is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { db, redis } from "@funtush/database";
import { generateAccessToken } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

function platformAdminToken(): string {
  return generateAccessToken({
    userId: "e2e-platform-admin",
    roleType: "PLATFORM",
    role: "SUPER_ADMIN",
  } as Parameters<typeof generateAccessToken>[0]);
}

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };

async function setPhoneOtpRequired(value: boolean) {
  const res = await request(app)
    .patch("/admin/settings")
    .set(adminHeaders)
    .set("Authorization", `Bearer ${platformAdminToken()}`)
    .send({ agencyPhoneOtpRequired: value });
  expect(res.status).toBe(200);
}

const createdEmails: string[] = [];
async function cleanupEmail(email: string) {
  await db.agency.deleteMany({ where: { email } }).catch(() => {});
  await db.user.deleteMany({ where: { email } }).catch(() => {});
}

d("Admin platform settings (e2e)", () => {
  afterEach(async () => {
    // Never leak a non-default toggle into other test files sharing this DB.
    await setPhoneOtpRequired(false);
  });

  it("GET /admin/settings is reachable with just the admin context (no bearer) and defaults to phone OTP off", async () => {
    const res = await request(app).get("/admin/settings").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data.agencyPhoneOtpRequired).toBe(false);
  });

  it("PATCH /admin/settings is unreachable without a platform-admin bearer token", async () => {
    const res = await request(app)
      .patch("/admin/settings")
      .set(adminHeaders)
      .send({ agencyPhoneOtpRequired: true });
    expect(res.status).toBe(401);
  });

  it("PATCH /admin/settings 400s on a non-boolean value", async () => {
    const res = await request(app)
      .patch("/admin/settings")
      .set(adminHeaders)
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ agencyPhoneOtpRequired: "yes" });
    expect(res.status).toBe(400);
  });

  it("PATCH /admin/settings persists the toggle, reflected by a subsequent GET", async () => {
    await setPhoneOtpRequired(true);
    const res = await request(app).get("/admin/settings").set(adminHeaders);
    expect(res.body.data.agencyPhoneOtpRequired).toBe(true);
  });
});

d("Agency registration — phone OTP toggle (e2e)", () => {
  beforeAll(async () => {
    // registration connects every new agency to the "FREE" tier
    await db.subscriptionTier.upsert({
      where: { name: "FREE" },
      update: {},
      create: { name: "FREE", maxStaff: 1, maxGuides: 5, monthlyPrice: 0, features: {} },
    });
  });

  afterAll(async () => {
    await setPhoneOtpRequired(false);
    for (const email of createdEmails) await cleanupEmail(email);
  });

  it("registers immediately when the toggle is off (default)", async () => {
    await setPhoneOtpRequired(false);
    const email = `otp-off-${Date.now()}@example.com`;
    createdEmails.push(email);

    const res = await request(app).post("/register/agency").send({
      name: "OTP Off Agency",
      email,
      password: "TrailPass!2026",
      phone: "9800000011",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.data.agencyId).toBeTruthy();

    const created = await db.agency.findUnique({ where: { email } });
    expect(created).toBeTruthy();
  });

  it("holds registration behind an SMS OTP when the toggle is on, and 202s with a sessionToken instead of creating the agency", async () => {
    await setPhoneOtpRequired(true);
    const email = `otp-on-${Date.now()}@example.com`;
    createdEmails.push(email);

    const res = await request(app).post("/register/agency").send({
      name: "OTP On Agency",
      email,
      password: "TrailPass!2026",
      phone: "9800000012",
    });

    expect(res.status).toBe(202);
    expect(res.body.data.otpRequired).toBe(true);
    expect(res.body.data.data.sessionToken).toBeTruthy();

    // Not created yet — the whole point of the gate.
    const notCreated = await db.agency.findUnique({ where: { email } });
    expect(notCreated).toBeNull();

    const otp = await redis.get(`agency-register:otp:${res.body.data.data.sessionToken}`);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("verify-otp with the wrong code 400s and does not create the agency", async () => {
    await setPhoneOtpRequired(true);
    const email = `otp-wrong-${Date.now()}@example.com`;
    createdEmails.push(email);

    const submit = await request(app).post("/register/agency").send({
      name: "OTP Wrong Agency",
      email,
      password: "TrailPass!2026",
      phone: "9800000013",
    });
    const { sessionToken } = submit.body.data.data;

    const res = await request(app)
      .post("/register/agency/verify-otp")
      .send({ sessionToken, otp: "000000" });
    expect(res.status).toBe(400);

    const notCreated = await db.agency.findUnique({ where: { email } });
    expect(notCreated).toBeNull();
  });

  it("verify-otp with the correct code completes registration", async () => {
    await setPhoneOtpRequired(true);
    const email = `otp-correct-${Date.now()}@example.com`;
    createdEmails.push(email);

    const submit = await request(app).post("/register/agency").send({
      name: "OTP Correct Agency",
      email,
      password: "TrailPass!2026",
      phone: "9800000014",
    });
    const { sessionToken } = submit.body.data.data;
    const otp = await redis.get(`agency-register:otp:${sessionToken}`);

    const res = await request(app)
      .post("/register/agency/verify-otp")
      .send({ sessionToken, otp });
    expect(res.status).toBe(201);
    expect(res.body.data.data.agencyId).toBeTruthy();

    const created = await db.agency.findUnique({ where: { email } });
    expect(created).toBeTruthy();

    // One-time use — replay must fail now that the Redis keys are gone.
    const replay = await request(app)
      .post("/register/agency/verify-otp")
      .send({ sessionToken, otp });
    expect(replay.status).toBe(400);
  });

  it("burns the session after 5 wrong codes — even the RIGHT code no longer works (no brute-forcing the phone proof)", async () => {
    await setPhoneOtpRequired(true);
    const email = `otp-brute-${Date.now()}@example.com`;
    createdEmails.push(email);

    const submit = await request(app).post("/register/agency").send({
      name: "OTP Brute Agency", email, password: "TrailPass!2026", phone: "9800000015",
    });
    const { sessionToken } = submit.body.data.data;
    const realOtp = await redis.get(`agency-register:otp:${sessionToken}`);
    const wrong = realOtp === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/register/agency/verify-otp").send({ sessionToken, otp: wrong });
      expect(res.status).toBe(400);
    }
    const sixth = await request(app).post("/register/agency/verify-otp").send({ sessionToken, otp: wrong });
    expect(sixth.status).toBe(429);
    expect(sixth.body.message).toMatch(/too many/i);

    // the correct code is now worthless: the session is gone
    const afterwards = await request(app).post("/register/agency/verify-otp").send({ sessionToken, otp: realOtp });
    expect(afterwards.status).toBe(400);
    expect(await db.agency.findUnique({ where: { email } })).toBeNull();
  });

  it("rejects missing / malformed fields with a 400 (not a 500 TypeError)", async () => {
    await setPhoneOtpRequired(false);
    for (const body of [{}, { name: "N", email: "a@b.co", password: "TrailPass!2026" }, { name: " ", email: "a@b.co", password: "TrailPass!2026", phone: "9800000016" }]) {
      const res = await request(app).post("/register/agency").send(body);
      expect(res.status).toBe(400);
      expect(typeof res.body.message).toBe("string");
    }
  });
});
