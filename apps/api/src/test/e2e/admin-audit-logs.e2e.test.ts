// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/audit-logs and the agency names on /admin/analytics/agencies —
// end-to-end against docker-compose.test.yml. Skips when the infra is down.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { generateAccessToken } from "@funtush/auth";
import { app } from "../../app";
import { getAuditCollection } from "../../models/auditLog.model";
import { getAnalyticsCollection } from "../../models/analyticsEvent.model";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const adminHeaders = { Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" };
const token = (role: "SUPER_ADMIN" | "PLATFORM_SUPPORT" = "SUPER_ADMIN") =>
  generateAccessToken({ userId: "e2e-audit-admin", roleType: "PLATFORM", role } as Parameters<typeof generateAccessToken>[0]);
const get = (qs = "", t = token()) =>
  request(app).get(`/admin/audit-logs${qs}`).set(adminHeaders).set("Authorization", `Bearer ${t}`);

d("Admin audit logs (e2e)", () => {
  const marker = `e2e-audit-${Date.now()}`;
  const actorA = `${marker}-A`;
  const actorB = `${marker}-B`;
  let ctx: E2EContext;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const col = await getAuditCollection();
    const base = Date.now() - 60_000;
    await col.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        action: (i % 2 ? "AGENCY_STATUS_CHANGED" : "BREAK_GLASS_ISSUED") as never,
        actor_id: i < 3 ? actorA : actorB,
        actor_ip: "127.0.0.1",
        target_type: "agency",
        target_id: marker,
        reason: `r${i}`,
        metadata: {},
        timestamp: new Date(base + i * 1000),
      })),
    );
  });

  afterAll(async () => {
    if (!RUN) return;
    const col = await getAuditCollection();
    await col.deleteMany({ target_id: marker });
    const ev = await getAnalyticsCollection();
    await ev.deleteMany({ agency_id: ctx?.agencyId });
    await ctx?.cleanup();
  });

  it("is closed to everyone but platform admins", async () => {
    expect((await request(app).get("/admin/audit-logs")).status).not.toBe(200);
    expect((await request(app).get("/admin/audit-logs").set(adminHeaders)).status).toBe(401);
    expect((await get("", ctx.accessToken)).status).toBe(403); // tenant token
    expect((await get("", token("PLATFORM_SUPPORT"))).status).toBe(403);
  });

  it("returns newest first, with ids, and never leaks Mongo's _id", async () => {
    const r = await get(`?target_id=${marker}`);
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: { reason: string }) => x.reason)).toEqual(["r4", "r3", "r2", "r1", "r0"]);
    expect(r.body.data[0].id).toMatch(/^[a-f0-9]{24}$/);
    expect(r.body.data[0]).not.toHaveProperty("_id");
    expect(r.body.actions).toContain("BREAK_GLASS_ISSUED");
  });

  it("filters by actor and by action", async () => {
    const a = await get(`?target_id=${marker}&actor_id=${actorA}`);
    expect(a.body.data).toHaveLength(3);
    const b = await get(`?target_id=${marker}&action=BREAK_GLASS_ISSUED`);
    expect(b.body.data.every((x: { action: string }) => x.action === "BREAK_GLASS_ISSUED")).toBe(true);
    expect(b.body.data).toHaveLength(3);
  });

  it("pages with limit + before, with no gaps or repeats", async () => {
    const p1 = await get(`?target_id=${marker}&limit=2`);
    expect(p1.body.data.map((x: { reason: string }) => x.reason)).toEqual(["r4", "r3"]);
    expect(p1.body.nextBefore).toBeTruthy();
    const p2 = await get(`?target_id=${marker}&limit=2&before=${encodeURIComponent(p1.body.nextBefore)}`);
    expect(p2.body.data.map((x: { reason: string }) => x.reason)).toEqual(["r2", "r1"]);
    const p3 = await get(`?target_id=${marker}&limit=2&before=${encodeURIComponent(p2.body.nextBefore)}`);
    expect(p3.body.data.map((x: { reason: string }) => x.reason)).toEqual(["r0"]);
    expect(p3.body.nextBefore).toBeNull();
  });

  it("rejects bad filters instead of passing them to Mongo", async () => {
    expect((await get("?action=NOT_A_REAL_ACTION")).status).toBe(400);
    expect((await get("?before=yesterday")).status).toBe(400);
  });

  it("cannot be steered with query-string operators", async () => {
    // ?actor_id[$ne]=A must not become { actor_id: { $ne: "A" } }.
    const r = await get(`?target_id=${marker}&actor_id[$ne]=${actorA}`);
    expect(r.status).toBe(200);
    // Operator syntax is ignored, not applied: nothing was inverted or narrowed to B only.
    expect(r.body.data.some((x: { actor_id: string }) => x.actor_id === actorA)).toBe(true);
  });

  it("attributes an admin action to the real admin whose token was sent, and rejects a garbage token outright", async () => {
    const who = `e2e-attrib-${Date.now()}`;
    const tok = generateAccessToken({ userId: who, roleType: "PLATFORM", role: "SUPER_ADMIN" } as Parameters<typeof generateAccessToken>[0]);

    await request(app).get(`/admin/agencies/${ctx.agencyId}`).set(adminHeaders).set("Authorization", `Bearer ${tok}`).expect(200);
    // GET /admin/agencies/:id now requires a real, verifiable platform-admin
    // JWT (requireAuth + requirePlatformPermission) — a garbage token is
    // rejected outright rather than falling back to IP-only attribution.
    await request(app).get(`/admin/agencies/${ctx.agencyId}`).set(adminHeaders).set("Authorization", "Bearer not-a-token").expect(401);

    const col = await getAuditCollection();
    await new Promise((r) => setTimeout(r, 300)); // AGENCY_VIEWED is fire-and-forget
    const rows = await col.find({ action: "AGENCY_VIEWED", target_id: ctx.agencyId }).toArray();
    expect(rows.some((r) => r.actor_id === who)).toBe(true);
    // The rejected request never reached the route handler, so it never
    // wrote a second (anonymous) AGENCY_VIEWED entry — unlike the old
    // IP-only-gated behavior this test used to document.
    expect(rows.length).toBe(1);
    await col.deleteMany({ target_id: ctx.agencyId });
  });

  it("clamps an absurd limit", async () => {
    const r = await get(`?limit=999999`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeLessThanOrEqual(200);
  });

  it("revenue-by-tier attributes paid bookings to the agency's real tier (not UNKNOWN), and counts agencies by tier", async () => {
    // getPlatformOverview reads real Booking rows now (TrekkerInvoice/analytics_events
    // both turned out to be unreliable — see platformAnalytics.service.ts), so the
    // fixture is a real PAID booking, not a Mongo event.
    const { db } = await import("@funtush/database");
    const tier = await db.subscriptionTier.findUniqueOrThrow({ where: { id: ctx.tierId }, select: { name: true } });
    const pkg = await seedPackage(ctx.agencyId);
    await db.booking.create({
      data: {
        agencyId: ctx.agencyId,
        packageId: pkg.packageId,
        departureDateId: pkg.departureDateId,
        groupSize: 1,
        totalPrice: 777,
        status: "PAID",
        trekkerName: "E2E Revenue Trekker",
        trekkerEmail: "e2e-revenue@example.com",
        trekkerPhone: "+9779800000000",
      },
    });
    const { redis } = await import("../../lib/redis");
    if (redis.status === "wait") await redis.connect();
    await redis.del("platform:analytics:overview", "platform:analytics:tiers");

    const r = await request(app).get("/admin/analytics").set(adminHeaders).set("Authorization", `Bearer ${token()}`);
    expect(r.status).toBe(200);
    const row = r.body.revenueByTier.find((x: { tier: string }) => x.tier === tier.name);
    expect(row?.revenue).toBeGreaterThanOrEqual(777);

    // agenciesByTier is a GROUP BY now: it must still add up to every agency.
    const total = Object.values(r.body.agenciesByTier as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(await db.agency.count());
    expect(r.body.agenciesByTier[tier.name]).toBeGreaterThanOrEqual(1);

    const t = await request(app).get("/admin/analytics/tiers").set(adminHeaders).set("Authorization", `Bearer ${token()}`);
    expect(t.status).toBe(200);
    expect(t.body.tierBreakdown[tier.name].active).toBeGreaterThanOrEqual(1);
    await redis.del("platform:analytics:overview", "platform:analytics:tiers");
  });

  it("analytics leaderboard carries agency names, not just ids", async () => {
    // getAgencyPerformance reads real Booking rows now (see getPlatformOverview's
    // doc comment) — a real CONFIRMED-or-beyond booking, not a Mongo event.
    const { db } = await import("@funtush/database");
    const pkg = await seedPackage(ctx.agencyId);
    await db.booking.create({
      data: {
        agencyId: ctx.agencyId,
        packageId: pkg.packageId,
        departureDateId: pkg.departureDateId,
        groupSize: 1,
        totalPrice: 100,
        status: "CONFIRMED",
        trekkerName: "E2E Leaderboard Trekker",
        trekkerEmail: "e2e-leaderboard@example.com",
        trekkerPhone: "+9779800000001",
      },
    });
    const { redis } = await import("../../lib/redis");
    if (redis.status === "wait") await redis.connect();
    await redis.del("platform:analytics:agencies");

    const r = await request(app).get("/admin/analytics/agencies").set(adminHeaders).set("Authorization", `Bearer ${token()}`);
    expect(r.status).toBe(200);
    const row = r.body.topByBookings.find((x: { agency_id: string }) => x.agency_id === ctx.agencyId);
    expect(row?.agency_name).toMatch(/^E2E Agency/);
    await redis.del("platform:analytics:agencies");
  });
});
