// Public inquiry form: strict validation, per-email rate limit, OTP brute-force protection.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { redis } from "../../lib/redis";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("inquiry hardening (e2e)", () => {
  let ctx: E2EContext;
  let packageId: string;
  let departureDateId: string;
  const tag = Date.now().toString().slice(-6);
  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const s = await seedPackage(ctx.agencyId);
    packageId = s.packageId;
    departureDateId = s.departureDateId;
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const body = (o: object = {}) => ({ packageId, departureDateId, groupSize: 2, trekkerName: "Maya Rai", trekkerEmail: `maya-${tag}@example.com`, trekkerPhone: "+977 9800000000", ...o });
  const post = (b: object) => request(app).post("/bookings/inquiry").send(b);

  it("rejects malformed input with a 400 (never priced, stored or emailed)", async () => {
    for (const b of [
      body({ groupSize: -3 }), body({ groupSize: 1.5 }), body({ groupSize: 999 }), body({ groupSize: "2" }),
      body({ trekkerName: "" }), body({ trekkerName: "<script>" }), body({ trekkerEmail: "nope" }), body({ trekkerPhone: "abc" }),
      body({ specialRequests: "x".repeat(1001) }), body({ addOns: "all" }), body({ addOns: [{ addOnId: "x", quantity: -1 }] }), body({ packageId: 5 }),
    ]) {
      expect((await post(b)).status, JSON.stringify(b).slice(0, 90)).toBe(400);
    }
  });

  it("accepts a valid inquiry and rate-limits one email address", async () => {
    const email = `limit-${tag}@example.com`;
    for (let i = 0; i < 5; i++) expect((await post(body({ trekkerEmail: email }))).status).toBe(202);
    const sixth = await post(body({ trekkerEmail: email }));
    expect(sixth.status).toBe(429);
  });

  it("burns the inquiry after too many wrong OTP guesses", async () => {
    const r = await post(body({ trekkerEmail: `otp-${tag}@example.com` }));
    expect(r.status).toBe(202);
    const token = r.body.data.sessionToken;
    const verify = (otp: string) => request(app).post("/bookings/inquiry/verify-otp").send({ sessionToken: token, otp });
    for (let i = 0; i < 5; i++) expect((await verify("000000")).status).toBe(400);
    const sixth = await verify("000000");
    expect(sixth.status).toBe(400);
    expect(JSON.stringify(sixth.body)).toMatch(/Too many|expired/);
    // even the real code no longer works
    const real = await redis.get(`inquiry:otp:${token}`);
    expect(real).toBeNull();
  });
});
