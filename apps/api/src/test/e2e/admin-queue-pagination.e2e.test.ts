// ─────────────────────────────────────────────────────────────────────────────
// The admin queues (KYC, fraud, ban registry, email queue) used to return every
// row. They now page — these tests pin that against the real DBs. Rows are added
// alongside whatever other tests left behind, so assertions are relative.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db, connectMongo } from "@funtush/database";
import { generateAccessToken } from "@funtush/auth";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;
const adminHeaders = {
  Host: "admin.funtush.com",
  "X-Forwarded-For": "127.0.0.1",
  Authorization: `Bearer ${generateAccessToken({ userId: "e2e-platform-admin", roleType: "PLATFORM", role: "SUPER_ADMIN" } as Parameters<typeof generateAccessToken>[0])}`,
};
const get = (path: string) => request(app).get(path).set(adminHeaders);

d("Admin queue pagination (e2e)", () => {
  const ctxs: E2EContext[] = [];
  const flagIds: string[] = [];
  const emailMarker = `pgq-${Date.now()}`;

  beforeAll(async () => {
    if (!RUN) return;
    for (let i = 0; i < 6; i++) ctxs.push(await createAgencyContext());

    // KYC: one submission per agency.
    for (const c of ctxs) await db.kycSubmission.create({ data: { agencyId: c.agencyId } });

    // Fraud: interleave signals so a wrong sort would put a YELLOW on page 1.
    const signals = ["YELLOW", "RED", "ORANGE", "YELLOW", "RED", "ORANGE"] as const;
    for (const [i, c] of ctxs.entries()) {
      const f = await db.fraudFlag.create({ data: { agencyId: c.agencyId, signal: signals[i], flagsTriggered: ["E2E"] } });
      flagIds.push(f.id);
    }

    // Ban registry: three banned agencies.
    for (const c of ctxs.slice(0, 3)) {
      await db.agency.update({ where: { id: c.agencyId }, data: { status: "BANNED", bannedAt: new Date(), banReason: "e2e" } });
    }

    // Email queue: 5 docs (mongo).
    const mongo = await connectMongo();
    const now = Date.now();
    await mongo.collection("email_queue").insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        to: `${emailMarker}-${i}@example.com`, subject: emailMarker, body: "b",
        status: i < 3 ? "sent" : "failed", retry_count: 0,
        createdAt: new Date(now + i * 1000), updatedAt: new Date(now + i * 1000),
      })),
    );
  });

  afterAll(async () => {
    if (!RUN) return;
    await db.fraudFlag.deleteMany({ where: { id: { in: flagIds } } }).catch(() => {});
    const mongo = await connectMongo();
    await mongo.collection("email_queue").deleteMany({ subject: emailMarker });
    for (const c of ctxs) await c.cleanup();
  });

  it("KYC queue: honours limit/page, reports the true total, and never repeats a row", async () => {
    const p1 = await get("/admin/kyc?limit=4&page=1");
    const p2 = await get("/admin/kyc?limit=4&page=2");
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(4);
    expect(p1.body.total).toBeGreaterThanOrEqual(6);
    expect(p1.body.meta).toMatchObject({ page: 1, limit: 4, total: p1.body.total });
    const ids = new Set([...p1.body.data, ...p2.body.data].map((r: { id: string }) => r.id));
    expect(ids.size).toBe(p1.body.data.length + p2.body.data.length);
  });

  it("clamps an absurd limit and ignores junk paging params", async () => {
    const r = await get("/admin/kyc?limit=999999&page=abc");
    expect(r.status).toBe(200);
    expect(r.body.meta.limit).toBe(100);
    expect(r.body.meta.page).toBe(1);
  });

  it("fraud queue: strongest signal first ACROSS page boundaries", async () => {
    const all = (await get("/admin/fraud/queue?limit=100")).body;
    const rank = { RED: 0, ORANGE: 1, YELLOW: 2 } as Record<string, number>;
    const signalsAll = all.data.map((f: { signal: string }) => rank[f.signal]);
    expect([...signalsAll].sort((a: number, b: number) => a - b)).toEqual(signalsAll);

    // Walk it two rows at a time: concatenated pages must equal the full ordering.
    const walked: string[] = [];
    for (let page = 1; page <= Math.ceil(all.total / 2); page++) {
      const r = await get(`/admin/fraud/queue?limit=2&page=${page}`);
      walked.push(...r.body.data.map((f: { id: string }) => f.id));
    }
    expect(walked).toEqual(all.data.map((f: { id: string }) => f.id));
    expect(all.total).toBe(all.data.length);
  });

  it("ban registry pages and counts", async () => {
    const r = await get("/admin/fraud/ban-registry?limit=2");
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeLessThanOrEqual(2);
    expect(r.body.total).toBeGreaterThanOrEqual(3);
    expect(r.body.meta.pages).toBe(Math.ceil(r.body.total / 2));
  });

  it("email queue: pages the list, but the summary stays GLOBAL", async () => {
    const all = await get("/admin/email-queue?limit=100");
    const failedOnly = await get("/admin/email-queue?status=failed&limit=1");
    expect(failedOnly.body.data).toHaveLength(1);
    expect(failedOnly.body.data[0].status).toBe("failed");
    expect(failedOnly.body.total).toBeGreaterThanOrEqual(2);
    // Cards must not zero out when a tab filters the list.
    expect(failedOnly.body.summary).toEqual(all.body.summary);
    expect(failedOnly.body.summary.total).toBe(
      failedOnly.body.summary.pending + failedOnly.body.summary.sent + failedOnly.body.summary.failed,
    );
  });

  it("email queue: newest first, pages don't overlap", async () => {
    const p1 = await get("/admin/email-queue?limit=2&page=1");
    const p2 = await get("/admin/email-queue?limit=2&page=2");
    const key = (e: { _id: string }) => e._id;
    const a = p1.body.data.map(key);
    const b = p2.body.data.map(key);
    expect(a.filter((x: string) => b.includes(x))).toEqual([]);
    const t = p1.body.data.map((e: { createdAt: string }) => new Date(e.createdAt).getTime());
    expect([...t].sort((x: number, y: number) => y - x)).toEqual(t);
  });

  it("rejects a bad email-queue status instead of querying with it", async () => {
    expect((await get("/admin/email-queue?status=nope")).status).toBe(400);
  });
});
