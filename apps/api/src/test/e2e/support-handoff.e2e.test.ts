// "View agency dashboard": one-time code → support-session tokens, single use, revocable.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { generateAccessToken } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;
const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };
const platformToken = () => generateAccessToken({ userId: "e2e-platform-admin", roleType: "PLATFORM", role: "SUPER_ADMIN" } as Parameters<typeof generateAccessToken>[0]);

d("support session hand-off (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => {
    if (RUN) ctx = await createAgencyContext();
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const start = () => request(app).post(`/admin/agencies/${ctx.agencyId}/impersonate`).set(adminHeaders).set("Authorization", `Bearer ${platformToken()}`).send({ reason: "Fixing a booking issue" });
  const exchange = (code: unknown) => request(app).post("/auth/support-session/exchange").send({ code });

  it("returns a code and exchanges it exactly once for working tokens", async () => {
    const s = await start();
    expect(s.status).toBe(201);
    expect(s.body.handoffCode).toMatch(/^[a-f0-9]{64}$/);

    const first = await exchange(s.body.handoffCode);
    expect(first.status).toBe(200);
    expect(first.body.agencyId).toBe(ctx.agencyId);
    expect(first.body.accessToken).toBeTruthy();
    expect(first.headers["cache-control"]).toContain("no-store");

    // Both credential shapes work against real agency routes.
    expect((await request(app).get("/agencies/me/analytics").set("x-refresh-token", first.body.refreshToken)).status).toBe(200);
    expect((await request(app).get("/agencies/me/staff").set("Authorization", `Bearer ${first.body.accessToken}`)).status).toBe(200);

    // Replay is refused.
    expect((await exchange(s.body.handoffCode)).status).toBe(400);
  });

  it("the access token lasts as long as the session (no refresh possible in a support session)", async () => {
    const s = await start();
    const t = await exchange(s.body.handoffCode);
    const exp = JSON.parse(Buffer.from(t.body.accessToken.split(".")[1], "base64url").toString()).exp as number;
    expect(exp * 1000 - Date.now()).toBeGreaterThan(50 * 60 * 1000);
  });

  it("rejects malformed, unknown and missing codes", async () => {
    for (const c of [undefined, "", "abc", "z".repeat(64), "a".repeat(64), 42, { $ne: 1 }]) {
      expect((await exchange(c)).status, String(c)).toBe(400);
    }
  });

  it("revoking the session kills the exchanged tokens", async () => {
    const s = await start();
    const t = await exchange(s.body.handoffCode);
    expect((await request(app).get("/agencies/me/analytics").set("x-refresh-token", t.body.refreshToken)).status).toBe(200);
    const del = await request(app).delete(`/admin/agencies/${ctx.agencyId}/impersonate`).set(adminHeaders).set("Authorization", `Bearer ${platformToken()}`);
    expect(del.status).toBe(200);
    expect((await request(app).get("/agencies/me/analytics").set("x-refresh-token", t.body.refreshToken)).status).toBe(401);
    expect((await request(app).get("/agencies/me/staff").set("Authorization", `Bearer ${t.body.accessToken}`)).status).toBe(401);
  });

  it("a tenant token can't start a support session", async () => {
    const r = await request(app).post(`/admin/agencies/${ctx.agencyId}/impersonate`).set(adminHeaders).set("Authorization", `Bearer ${ctx.accessToken}`).send({ reason: "x" });
    expect(r.status).toBe(403);
  });
});
