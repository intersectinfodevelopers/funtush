// ─────────────────────────────────────────────────────────────────────────────
// QA pass — pagination, caching, tenant resolution, metrics (e2e).
//
// Real Postgres/Redis (docker-compose.test.yml). Skips cleanly when the DB is
// unreachable. Each block pins a defect found in the backend audit so it
// can't quietly come back.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { db, redis } from "@funtush/database";
import { normalizeEmail } from "@funtush/shared";
import { app } from "../../app";
import { getTenantByCustomDomain } from "../../services/tenant.service";
import { trackBooking, recordPaymentGateway, recordRevenue, recordSos } from "../../services/prometheusMetrics";
import { issueBreakGlassToken } from "../../services/admin.service";
import { lockExpiredAgencies } from "../../services/agency.service";
import { expireUnpaidBookings } from "../../services/payment.service";
import { sendReviewInvitations } from "../../services/review.service";
import { acquireJobLock } from "../../jobs/jobLock";
import { rankAgencies } from "../../services/marketplaceRanking.service";
import { agencyCustomerListService, agencyCustomerListFromBookings } from "../../services/agencyCustomer.service";
import { dbAvailable, createAgencyContext, seedPackage, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const refreshHeader = (ctx: E2EContext) => ({ "x-refresh-token": ctx.refreshToken });

/** Trekker + COMPLETED booking + review (rating) for `ctx`'s agency. */
async function seedReviewWithRating(ctx: E2EContext, rating: number, when: Date) {
  const s = randomUUID().slice(0, 8);
  const email = `qa-reviewer-${s}@example.com`;
  const user = await db.user.create({
    data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
    select: { id: true },
  });
  const trekker = await db.trekker.create({ data: { userId: user.id, fullName: `Reviewer ${s}` }, select: { id: true } });
  const seed = await seedPackage(ctx.agencyId);
  const booking = await db.booking.create({
    data: {
      agencyId: ctx.agencyId, trekkerId: trekker.id, packageId: seed.packageId,
      departureDateId: seed.departureDateId, groupSize: 1, totalPrice: 100,
      trekkerName: `Reviewer ${s}`, trekkerEmail: email, trekkerPhone: "9800000000", status: "COMPLETED",
    },
    select: { id: true },
  });
  await db.review.create({
    data: { bookingId: booking.id, trekkerId: trekker.id, agencyId: ctx.agencyId, rating, text: `r${rating}`, createdAt: when },
  });
  return { userId: user.id };
}

d("Public agency reviews — pagination keeps the summary honest (e2e)", () => {
  let ctx: E2EContext;
  let slug: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    slug = (await db.agency.findUniqueOrThrow({ where: { id: ctx.agencyId }, select: { slug: true } })).slug;
    // 5 reviews, distinct timestamps: ratings 5,5,4,3,1  → avg 3.6
    const ratings = [5, 5, 4, 3, 1];
    for (let i = 0; i < ratings.length; i++) {
      const r = await seedReviewWithRating(ctx, ratings[i], new Date(Date.now() - i * 60_000));
      userIds.push(r.userId);
    }
  });

  afterAll(async () => {
    if (!ctx) return;
    await db.review.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await ctx.cleanup();
  });

  it("returns only one page of reviews but a summary over ALL of them", async () => {
    const res = await request(app).get(`/agencies/${slug}/reviews?limit=2&page=1`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.reviews).toHaveLength(2);
    expect(data.totalReviews).toBe(5);
    expect(data.averageRating).toBe(3.6);
    expect(data.pages).toBe(3);
    // star split is a share of all 5 reviews, not of the 2 on this page
    expect(data.starDistribution).toEqual({ "1": 20, "2": 0, "3": 20, "4": 20, "5": 40 });
  });

  it("walks every page with no duplicates and no gaps", async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await request(app).get(`/agencies/${slug}/reviews?limit=2&page=${page}`);
      seen.push(...res.body.data.reviews.map((r: { id: string }) => r.id));
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("clamps a hostile limit and tolerates garbage params", async () => {
    const big = await request(app).get(`/agencies/${slug}/reviews?limit=999999`);
    expect(big.status).toBe(200);
    expect(big.body.data.limit).toBe(100);

    const junk = await request(app).get(`/agencies/${slug}/reviews?limit=abc&page=-4`);
    expect(junk.status).toBe(200);
    expect(junk.body.data.page).toBe(1);
    expect(junk.body.data.limit).toBe(20);
  });

  it("404s an unknown agency with a real message (not an empty object)", async () => {
    const res = await request(app).get(`/agencies/does-not-exist-${randomUUID()}/reviews`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Agency not found");
  });
});

d("Agency packages list — paginated, stable order (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    for (let i = 0; i < 5; i++) await seedPackage(ctx.agencyId);
  });

  afterAll(async () => {
    if (ctx) {
      await db.trekPackage.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
      await ctx.cleanup();
    }
  });

  it("keeps `data` an array (existing clients) and adds meta", async () => {
    const res = await request(app).get("/agencies/packages?limit=2").set(refreshHeader(ctx));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ total: 5, page: 1, limit: 2, pages: 3 });
  });

  it("pages never repeat or drop a package", async () => {
    const ids: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await request(app).get(`/agencies/packages?limit=2&page=${page}`).set(refreshHeader(ctx));
      ids.push(...res.body.data.map((p: { id: string }) => p.id));
    }
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it("is still tenant-scoped (another agency's packages never appear)", async () => {
    const other = await createAgencyContext();
    try {
      const res = await request(app).get("/agencies/packages?limit=100").set(refreshHeader(other));
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    } finally {
      await other.cleanup();
    }
  });
});

d("Bookings list — limit is clamped (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => { if (RUN) ctx = await createAgencyContext(); });
  afterAll(async () => { if (ctx) await ctx.cleanup(); });

  const bearer = () => ({ Authorization: `Bearer ${ctx.accessToken}` });

  it("caps ?limit at 100 instead of honouring it", async () => {
    const res = await request(app).get("/bookings?limit=999999").set(bearer());
    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBe(100);
  });

  it("falls back to defaults on non-numeric input instead of a NaN query", async () => {
    const res = await request(app).get("/bookings?limit=abc&page=xyz").set(bearer());
    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(20);
  });
});

d("Agency customers list — page 2 returns page 2 (e2e)", () => {
  let ctx: E2EContext;
  const userIds: string[] = [];

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    const seed = await seedPackage(ctx.agencyId);
    for (let i = 0; i < 3; i++) {
      const email = `qa-cust-${i}-${randomUUID().slice(0, 6)}@example.com`;
      const user = await db.user.create({
        data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
        select: { id: true },
      });
      userIds.push(user.id);
      const trekker = await db.trekker.create({ data: { userId: user.id, fullName: `Customer ${i}` }, select: { id: true } });
      await db.booking.create({
        data: {
          agencyId: ctx.agencyId, trekkerId: trekker.id, packageId: seed.packageId,
          departureDateId: seed.departureDateId, groupSize: 1, totalPrice: 100 * (i + 1),
          trekkerName: `Customer ${i}`, trekkerEmail: email, trekkerPhone: "9800000000", status: "CONFIRMED",
        },
      });
    }
  });

  afterAll(async () => {
    if (!ctx) return;
    await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await ctx.cleanup();
  });

  it("returns disjoint, correctly-sized pages (was: slice(5, '55') on string params)", async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await request(app).get(`/agencies/me/customers?limit=1&page=${page}`).set(refreshHeader(ctx));
      expect(res.status).toBe(200);
      expect(res.body.result.data).toHaveLength(1);
      expect(res.body.result.meta).toMatchObject({ page, limit: 1, total: 3, totalPages: 3 });
      seen.push(res.body.result.data[0].trekkerId);
    }
    expect(new Set(seen).size).toBe(3);
  });
});

d("Agency customers — filter/sort/search happen in the database (e2e)", () => {
  let ctx: E2EContext;
  const userIds: string[] = [];
  const ids: Record<string, string> = {};

  async function customer(name: string, prices: number[]) {
    const email = `qa-c-${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
    const user = await db.user.create({
      data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
      select: { id: true },
    });
    userIds.push(user.id);
    const trekker = await db.trekker.create({ data: { userId: user.id, fullName: name, phone: "9811112222" }, select: { id: true } });
    ids[name] = trekker.id;
    const seed = await seedPackage(ctx.agencyId);
    for (const price of prices) {
      await db.booking.create({
        data: {
          agencyId: ctx.agencyId, trekkerId: trekker.id, packageId: seed.packageId, departureDateId: seed.departureDateId,
          groupSize: 1, totalPrice: price, trekkerName: name, trekkerEmail: email, trekkerPhone: "9811112222", status: "CONFIRMED",
        },
      });
    }
  }

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    await customer("Alice", [100]);            // new, spend 100
    await customer("Bob", [300, 200]);         // repeat, spend 500
    await customer("Carol", [50, 50, 50]);     // repeat, spend 150
  });

  afterAll(async () => {
    if (!ctx) return;
    await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await ctx.cleanup();
  });

  const list = async (qs: string) => (await request(app).get(`/agencies/me/customers?${qs}`).set(refreshHeader(ctx))).body.result;

  it("sorts by total spending across the whole set, then pages through it", async () => {
    const r = await list("sortBy=totalSpending&sortOrder=desc&limit=2&page=1");
    expect(r.data.map((c: { fullName: string }) => c.fullName)).toEqual(["Bob", "Carol"]);
    expect(r.meta).toMatchObject({ total: 3, totalPages: 2 });
    expect(r.data[0].totalSpending).toBe(500);
    const p2 = await list("sortBy=totalSpending&sortOrder=desc&limit=2&page=2");
    expect(p2.data.map((c: { fullName: string }) => c.fullName)).toEqual(["Alice"]);
  });

  it("sorts by booking count ascending", async () => {
    const r = await list("sortBy=totalBookings&sortOrder=asc");
    expect(r.data.map((c: { fullName: string }) => c.fullName)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("customerType=repeat / new filter the groups, and `total` reflects the filter", async () => {
    const repeat = await list("customerType=repeat");
    expect(repeat.data.map((c: { fullName: string }) => c.fullName).sort()).toEqual(["Bob", "Carol"]);
    expect(repeat.meta.total).toBe(2);
    const fresh = await list("customerType=new");
    expect(fresh.data.map((c: { fullName: string }) => c.fullName)).toEqual(["Alice"]);
    expect(fresh.data[0]).toMatchObject({ isNewCustomer: true, repeatVisitor: false });
  });

  it("searches name case-insensitively and by email, scoped to this agency", async () => {
    expect((await list("search=aLiCe")).data.map((c: { fullName: string }) => c.fullName)).toEqual(["Alice"]);
    expect((await list("search=qa-c-bob")).data.map((c: { fullName: string }) => c.fullName)).toEqual(["Bob"]);
    const none = await list("search=zzz-nobody");
    expect(none.data).toEqual([]);
    expect(none.meta.total).toBe(0);
  });

  it("caches per agency+query for 10s: a repeat is a HIT, and another agency never sees it", async () => {
    const qs = "sortBy=totalBookings&sortOrder=desc&limit=3&page=1&search=Bob";
    const a = await request(app).get(`/agencies/me/customers?${qs}`).set(refreshHeader(ctx));
    const b = await request(app).get(`/agencies/me/customers?${qs}`).set(refreshHeader(ctx));
    expect(a.headers["x-cache"]).toBe("MISS");
    expect(b.headers["x-cache"]).toBe("HIT");
    expect(b.body).toEqual(a.body);

    const other = await createAgencyContext();
    try {
      const o = await request(app).get(`/agencies/me/customers?${qs}`).set(refreshHeader(other));
      expect(o.headers["x-cache"]).toBe("MISS"); // its own key, its own (empty) result
      expect(o.body.result.data).toEqual([]);
    } finally {
      await other.cleanup();
    }
  });

  it("does not leak another agency's customers", async () => {
    const other = await createAgencyContext();
    try {
      const res = await request(app).get("/agencies/me/customers").set(refreshHeader(other));
      expect(res.body.result.meta.total).toBe(0);
    } finally {
      await other.cleanup();
    }
  });
});

d("Tenant resolution by custom domain (e2e)", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await db.agency.delete({ where: { id } }).catch(() => {});
  });

  async function agencyWithDomain(domain: string, status: "PENDING" | "VERIFIED" | "NONE") {
    const ctx = await createAgencyContext();
    created.push(ctx.agencyId);
    await db.agency.update({ where: { id: ctx.agencyId }, data: { customDomain: domain, customDomainStatus: status } });
    return ctx;
  }

  it("resolves a VERIFIED custom domain to its agency (previously queried a model that doesn't exist → always 404)", async () => {
    const domain = `verified-${randomUUID().slice(0, 8)}.example.org`;
    const ctx = await agencyWithDomain(domain, "VERIFIED");
    const tenant = await getTenantByCustomDomain(domain);
    expect(tenant?.agencyId).toBe(ctx.agencyId);
    expect(tenant?.tenantId).toBeTruthy();
    await redis.del(`tenant:domain:${domain}`);
  });

  it("does NOT resolve a domain the agency hasn't proven it owns", async () => {
    const domain = `pending-${randomUUID().slice(0, 8)}.example.org`;
    await agencyWithDomain(domain, "PENDING");
    expect(await getTenantByCustomDomain(domain)).toBeNull();
  });

  it("returns null for an unknown domain", async () => {
    expect(await getTenantByCustomDomain(`nope-${randomUUID()}.example.org`)).toBeNull();
  });
});

d("Marketplace public read caching (e2e)", () => {
  it("serves /marketplace/featured from cache on the second call", async () => {
    await redis.del("marketplace:public:featured");
    const first = await request(app).get("/marketplace/featured");
    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");
    const second = await request(app).get("/marketplace/featured");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body).toEqual(first.body);
  });

  it("never caches a 404, so a just-created destination isn't hidden", async () => {
    const slug = `ghost-${randomUUID().slice(0, 8)}`;
    const res = await request(app).get(`/marketplace/destinations/${slug}`);
    expect(res.status).toBe(404);
    expect(await redis.get(`marketplace:public:destination:${slug}`)).toBeNull();
  });

  it("caches anonymous /marketplace/agencies but keys by filter", async () => {
    await redis.del(
      `marketplace:agencies:${JSON.stringify({ limit: 3 })}`,
      `marketplace:agencies:${JSON.stringify({ limit: 4 })}`,
    );
    const a = await request(app).get("/marketplace/agencies?limit=3");
    const b = await request(app).get("/marketplace/agencies?limit=3");
    const c = await request(app).get("/marketplace/agencies?limit=4");
    expect(a.headers["x-cache"]).toBe("MISS");
    expect(b.headers["x-cache"]).toBe("HIT");
    expect(c.headers["x-cache"]).toBe("MISS");
  });
});

d("Prometheus /metrics (e2e)", () => {
  it("exposes route *patterns*, not raw ids, plus business counters", async () => {
    const ctx = await createAgencyContext();
    try {
      await request(app).get(`/bookings/${randomUUID()}`).set({ Authorization: `Bearer ${ctx.accessToken}` });
      await request(app).get("/definitely/not/a/route");
      trackBooking("CONFIRMED");

      const res = await request(app).get("/metrics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.text).toMatch(/http_requests_total\{[^}]*route="\/bookings\/:id"[^}]*\}/);
      expect(res.text).not.toMatch(/route="\/bookings\/[0-9a-f]{8}-/);
      // unmatched routes share one bucket — raw paths would be unbounded cardinality
      expect(res.text).toMatch(/http_requests_total\{[^}]*route="unmatched"[^}]*status_code="404"/);
      expect(res.text).not.toContain("/definitely/not/a/route");
      expect(res.text).toMatch(/bookings_total\{status="CONFIRMED"\} \d+/);
    } finally {
      await ctx.cleanup();
    }
  });
});

d("Break-glass token persists for real (e2e)", () => {
  it("writes a durable row and mirrors it in Redis (table didn't exist before)", async () => {
    const ctx = await createAgencyContext();
    try {
      const { token, recordId, expiresAt } = await issueBreakGlassToken(ctx.agencyId, "10.0.0.9");
      const row = await db.breakGlassToken.findUnique({ where: { id: recordId } });
      expect(row).toMatchObject({ token, agencyId: ctx.agencyId, issuedByIp: "10.0.0.9" });
      expect(row!.expiresAt.getTime()).toBe(expiresAt.getTime());
      expect(await redis.get(`break-glass:${token}`)).toBeTruthy();
      await redis.del(`break-glass:${token}`);
    } finally {
      await ctx.cleanup(); // agency delete cascades the token row
    }
  });
});

d("Trial-expiry job actually locks expired agencies (e2e)", () => {
  it("locks an ACTIVE agency whose trial ended, leaves a live-trial one alone (job used to throw on an unknown field every night)", async () => {
    const expired = await createAgencyContext();
    const live = await createAgencyContext();
    try {
      await db.agency.update({ where: { id: expired.agencyId }, data: { status: "ACTIVE", trialExpiresAt: new Date(Date.now() - 86_400_000) } });
      await db.agency.update({ where: { id: live.agencyId }, data: { status: "ACTIVE", trialExpiresAt: new Date(Date.now() + 86_400_000) } });

      await lockExpiredAgencies();

      expect((await db.agency.findUniqueOrThrow({ where: { id: expired.agencyId } })).status).toBe("LOCKED");
      expect((await db.agency.findUniqueOrThrow({ where: { id: live.agencyId } })).status).toBe("ACTIVE");
    } finally {
      await expired.cleanup();
      await live.cleanup();
    }
  });
});

d("/metrics access control + business counters (e2e)", () => {
  const original = { token: process.env.METRICS_TOKEN, env: process.env.NODE_ENV };
  afterAll(() => {
    if (original.token === undefined) delete process.env.METRICS_TOKEN; else process.env.METRICS_TOKEN = original.token;
    process.env.NODE_ENV = original.env;
  });

  it("requires the bearer token when METRICS_TOKEN is set", async () => {
    process.env.METRICS_TOKEN = "s3cret-scrape-token";
    expect((await request(app).get("/metrics")).status).toBe(401);
    expect((await request(app).get("/metrics").set("Authorization", "Bearer wrong")).status).toBe(401);
    expect((await request(app).get("/metrics").set("Authorization", "Bearer s3cret-scrape-token")).status).toBe(200);
  });

  it("fails closed (404) in production with no token configured, open in dev", async () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = "production";
    expect((await request(app).get("/metrics")).status).toBe(404);
    process.env.NODE_ENV = "test";
    expect((await request(app).get("/metrics")).status).toBe(200);
  });

  it("exposes payment-gateway, revenue and SOS counters", async () => {
    delete process.env.METRICS_TOKEN;
    recordPaymentGateway("khalti", "success", Date.now() - 20);
    recordPaymentGateway("esewa", "invalid");
    recordRevenue("NPR", 1500);
    recordRevenue("NPR", -5); // ignored: not real money
    recordSos("triggered");
    const text = (await request(app).get("/metrics")).text;
    expect(text).toMatch(/payment_gateway_requests_total\{gateway="khalti",status="success"\} \d+/);
    expect(text).toMatch(/payment_gateway_errors_total\{gateway="esewa",error_type="invalid"\} \d+/);
    expect(text).toMatch(/revenue_total\{currency="NPR"\} 1500/);
    expect(text).toMatch(/sos_requests_total\{status="triggered"\} \d+/);
  });
});

d("X-Forwarded-For spoofing can't bypass the admin whitelist or rate limits (e2e)", () => {
  it("ignores an attacker-supplied leading 127.0.0.1 — only the proxy-appended (last) hop counts", async () => {
    // What a proxy produces when a client sends "X-Forwarded-For: 127.0.0.1":
    // the client's value first, the address the proxy really saw appended.
    const spoofed = await request(app)
      .get("/admin/settings")
      .set({ Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1, 198.51.100.7" });
    expect(spoofed.status).toBe(404); // not whitelisted: treated as a non-admin host

    const genuine = await request(app)
      .get("/admin/settings")
      .set({ Host: "admin.funtush.com", "X-Forwarded-For": "127.0.0.1" });
    // /admin/settings requires a login, so a whitelisted caller with no token gets
    // 401 — proof it reached the admin context — whereas the spoofed one got 404.
    expect(genuine.status).toBe(401);
  });

  it("can't dodge the per-IP rate limit by rotating the client-controlled header", async () => {
    const realClient = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const key = `ratelimit:${realClient}:GET:/subscription-tiers`;
    // The DEFAULT limit is 200/min. Start the real client's counter at 197
    // (rather than sending ~200 requests) so the assertion is fast and immune
    // to suite load: three more requests fit, everything after must be 429 —
    // no matter how the attacker varies the header's leading value.
    await redis.set(key, "197", "EX", 60);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .get("/subscription-tiers")
        .set("X-Forwarded-For", `10.${i}.${(i * 7) % 250}.1, ${realClient}`);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429, 429]);
    await redis.del(key);
  });
});

d("agency_customer_stats trigger stays identical to a fresh aggregation (e2e)", () => {
  let ctx: E2EContext;
  const userIds: string[] = [];
  const trekkers: string[] = [];
  let seed: Awaited<ReturnType<typeof seedPackage>>;

  async function newTrekker(name: string) {
    const email = `qa-trig-${name}-${randomUUID().slice(0, 6)}@example.com`;
    const user = await db.user.create({
      data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
      select: { id: true },
    });
    userIds.push(user.id);
    const t = await db.trekker.create({ data: { userId: user.id, fullName: name }, select: { id: true } });
    trekkers.push(t.id);
    return t.id;
  }
  const book = (trekkerId: string | null, price: number, createdAt?: Date) =>
    db.booking.create({
      data: {
        agencyId: ctx.agencyId, trekkerId, packageId: seed.packageId, departureDateId: seed.departureDateId,
        groupSize: 1, totalPrice: price, trekkerName: "n", trekkerEmail: "n@example.com", trekkerPhone: "9800000000",
        status: "CONFIRMED", ...(createdAt ? { createdAt } : {}),
      },
    });

  /** stats table vs a fresh GROUP BY over bookings, compared as maps */
  async function assertStatsMatchBookings() {
    const truth = await db.booking.groupBy({
      by: ["trekkerId"], where: { agencyId: ctx.agencyId, trekkerId: { not: null } },
      _count: { id: true }, _sum: { totalPrice: true }, _max: { createdAt: true },
    });
    const stats = await db.agencyCustomerStat.findMany({ where: { agencyId: ctx.agencyId } });
    const norm = (rows: { id: string; n: number; sum: number; last: number }[]) =>
      rows.sort((a, b) => a.id.localeCompare(b.id));
    expect(norm(stats.map((r) => ({ id: r.trekkerId, n: r.totalBookings, sum: Number(r.totalSpent), last: r.lastBookingAt.getTime() }))))
      .toEqual(norm(truth.map((g) => ({ id: g.trekkerId as string, n: g._count.id, sum: Number(g._sum.totalPrice ?? 0), last: g._max.createdAt!.getTime() }))));
  }

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    seed = await seedPackage(ctx.agencyId);
  });
  afterAll(async () => {
    if (!ctx) return;
    await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await ctx.cleanup();
  });

  it("tracks insert, price change, moving a booking to another customer, delete, and trekker deletion", async () => {
    const a = await newTrekker("TrigA");
    const b = await newTrekker("TrigB");
    const old = new Date(Date.now() - 5 * 86_400_000);

    const b1 = await book(a, 100, old);
    await book(a, 250);
    const b3 = await book(b, 40);
    await book(null, 999); // no trekker: never a customer
    await assertStatsMatchBookings();

    await db.booking.update({ where: { id: b1.id }, data: { totalPrice: 175 } });           // price edit
    await assertStatsMatchBookings();

    await db.booking.update({ where: { id: b3.id }, data: { trekkerId: a } });              // customer changes
    await assertStatsMatchBookings();
    expect(await db.agencyCustomerStat.findUnique({ where: { agencyId_trekkerId: { agencyId: ctx.agencyId, trekkerId: b } } })).toBeNull(); // B has none left

    await db.booking.update({ where: { id: b1.id }, data: { status: "CANCELLED" } });       // status edit: no stats change
    await assertStatsMatchBookings();

    await db.booking.delete({ where: { id: b1.id } });                                      // delete recomputes last_booking_at
    await assertStatsMatchBookings();
    const remaining = await db.agencyCustomerStat.findUniqueOrThrow({ where: { agencyId_trekkerId: { agencyId: ctx.agencyId, trekkerId: a } } });
    expect(remaining.totalBookings).toBe(2);

    await db.trekker.delete({ where: { id: a } });                                          // trekker removed entirely
    trekkers.splice(trekkers.indexOf(a), 1);
    await assertStatsMatchBookings();
  });

  it("LIKE wildcards in a search term are literal, not patterns", async () => {
    await newTrekker("Wild_Card"); // contains a literal underscore
    await newTrekker("WildXCard"); // would match if `_` acted as a wildcard
    const hit = await agencyCustomerListService(ctx.agencyId, { page: 1, limit: 20, search: "ild_Car" });
    expect(hit.data.map((c) => c.fullName)).toEqual([]); // trekkers exist but have no bookings here -> not customers
    const t = await db.trekker.findFirstOrThrow({ where: { fullName: "Wild_Card" }, select: { id: true } });
    const t2 = await db.trekker.findFirstOrThrow({ where: { fullName: "WildXCard" }, select: { id: true } });
    await book(t.id, 10);
    await book(t2.id, 10);
    const literal = await agencyCustomerListService(ctx.agencyId, { page: 1, limit: 20, search: "ild_Car" });
    expect(literal.data.map((c) => c.fullName)).toEqual(["Wild_Card"]);
    const percent = await agencyCustomerListService(ctx.agencyId, { page: 1, limit: 20, search: "ild%ard" });
    expect(percent.data).toEqual([]);
  });

  it("the fast (stats) path returns exactly what the booking-aggregation path returns, for every sort/filter", async () => {
    const names = ["Zed", "Yan", "Xia", "Wes", "Val"];
    for (let i = 0; i < names.length; i++) {
      const t = await newTrekker(`Diff${names[i]}`);
      for (let j = 0; j <= i % 3; j++) await book(t, 30 * (i + 1) + j, new Date(Date.now() - (i * 3 + j) * 3_600_000));
    }
    const shapes = [
      {}, { sortBy: "totalBookings", sortOrder: "asc" }, { sortBy: "totalSpending", sortOrder: "desc" },
      { sortBy: "lastBookingDate", sortOrder: "asc" }, { customerType: "repeat" }, { customerType: "new" },
      { search: "diff" }, { search: "DIFFYAN" }, { search: "diffz", sortBy: "totalSpending" }, { search: "iff", customerType: "repeat" }, { limit: 2, page: 2, sortBy: "totalSpending" },
    ] as const;
    for (const shape of shapes) {
      const q = { limit: 50, page: 1, ...shape } as never;
      const fast = await agencyCustomerListService(ctx.agencyId, q);
      const slow = await agencyCustomerListFromBookings(ctx.agencyId, q);
      expect(fast.meta, JSON.stringify(shape)).toEqual(slow.meta);
      // lastBookingDate compared as timestamps; rows compared in order
      const proj = (r: { data: Array<Record<string, unknown>> }) =>
        r.data.map((c) => ({ ...c, lastBookingDate: new Date(c.lastBookingDate as Date).getTime() }));
      expect(proj(fast), JSON.stringify(shape)).toEqual(proj(slow));
    }
  });
});

d("Marketplace ranking scores a bounded candidate pool (e2e)", () => {
  it("takes the top-K by visibility score, but never drops an agency this trekker has booked with", async () => {
    const tag = `RankCap${randomUUID().slice(0, 6)}`;
    const tier = await db.subscriptionTier.upsert({
      where: { name: "E2E_RANKCAP" }, update: {},
      create: { name: "E2E_RANKCAP", maxStaff: 5, maxGuides: 5, monthlyPrice: 10, features: {} },
    });
    const made: { id: string; label: string }[] = [];
    for (const [label, score] of [["High", 90], ["Mid", 50], ["Low", 10]] as const) {
      const a = await db.agency.create({
        data: {
          name: `${tag} ${label}`, email: `${tag}-${label}@example.com`, slug: `${tag}-${label}`.toLowerCase(),
          tierId: tier.id, status: "ACTIVE", kyc: { create: { status: "APPROVED" } },
          visibilityScore: { create: { baseScore: score, finalScore: score } },
        },
        select: { id: true },
      });
      made.push({ id: a.id, label });
    }
    const [high, mid, low] = made;

    const email = `${tag}@example.com`;
    const user = await db.user.create({
      data: { email, normalizedEmail: normalizeEmail(email), passwordHash: "x", role: "STAFF", roleType: "TREKKER" },
      select: { id: true },
    });
    const trekker = await db.trekker.create({ data: { userId: user.id, fullName: "Ranker" }, select: { id: true } });
    const seed = await seedPackage(low.id);
    await db.booking.create({
      data: {
        agencyId: low.id, trekkerId: trekker.id, packageId: seed.packageId, departureDateId: seed.departureDateId,
        groupSize: 1, totalPrice: 10, trekkerName: "R", trekkerEmail: email, trekkerPhone: "9800000000", status: "COMPLETED",
      },
    });

    try {
      const idsOf = (r: Awaited<ReturnType<typeof rankAgencies>>) => [...r.trekkedWith, ...r.recommended].map((a) => a.id);

      // anonymous, pool of 1: only the highest-scored agency is even considered
      const anon = await rankAgencies({ candidateLimit: 1, filters: { search: tag } });
      expect(idsOf(anon)).toEqual([high.id]);

      // pool of 2: the top two by score
      const two = await rankAgencies({ candidateLimit: 2, filters: { search: tag } });
      expect(idsOf(two).sort()).toEqual([high.id, mid.id].sort());

      // personalised, pool of 1: top agency PLUS the one the trekker has booked with
      const mine = await rankAgencies({ trekkerId: user.id, candidateLimit: 1, filters: { search: tag } });
      expect(idsOf(mine).sort()).toEqual([high.id, low.id].sort());
      expect(mine.trekkedWith.map((a) => a.id)).toEqual([low.id]);
      expect(idsOf(mine)).not.toContain(mid.id);
    } finally {
      await db.booking.deleteMany({ where: { agencyId: low.id } }).catch(() => {});
      await db.agency.deleteMany({ where: { id: { in: made.map((m) => m.id) } } }).catch(() => {});
      await db.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});

d("Batch jobs page through more rows than one batch, and skip what they should (e2e)", () => {
  let ctx: E2EContext;
  let seed: Awaited<ReturnType<typeof seedPackage>>;
  const baseBooking = () => ({
    agencyId: ctx.agencyId, packageId: seed.packageId, departureDateId: seed.departureDateId,
    groupSize: 1, totalPrice: 10, trekkerName: "Job", trekkerEmail: "job@example.com", trekkerPhone: "9800000000",
  });

  beforeAll(async () => {
    if (!RUN) return;
    ctx = await createAgencyContext();
    seed = await seedPackage(ctx.agencyId, { maxSlots: 1000 });
    await db.trekDepartureDate.update({ where: { id: seed.departureDateId }, data: { bookedSlots: 500 } });
  });
  afterAll(async () => {
    if (!ctx) return;
    await db.booking.deleteMany({ where: { agencyId: ctx.agencyId } }).catch(() => {});
    await ctx.cleanup();
  });

  it("review invitations: 205 completed bookings (> one batch of 200) each get exactly one invitation; a re-run adds none", async () => {
    const before = await db.booking.count({ where: { agencyId: ctx.agencyId } });
    expect(before).toBe(0);
    await db.booking.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({ id: `qa-rv-${ctx.agencyId.slice(0, 8)}-${i}`, ...baseBooking(), status: "COMPLETED" as const })),
    });
    const ids = Array.from({ length: 205 }, (_, i) => `qa-rv-${ctx.agencyId.slice(0, 8)}-${i}`);

    await sendReviewInvitations();
    expect(await db.reviewInvitation.count({ where: { bookingId: { in: ids } } })).toBe(205);

    await sendReviewInvitations(); // idempotent: nothing new, no unique-violation crash
    expect(await db.reviewInvitation.count({ where: { bookingId: { in: ids } } })).toBe(205);
  }, 60_000); // the job is platform-wide by design: it also walks every other completed booking in the shared test DB

  it("expire-unpaid: cancels only PAYMENT_PENDING bookings past their window, releases their slots, leaves paid/unexpired alone", async () => {
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 3_600_000);
    const mk = async (id: string, status: "PAYMENT_PENDING" | "PAID", expiresAt: Date, used = false) => {
      await db.booking.create({ data: { id, ...baseBooking(), status } });
      await db.paymentLink.create({ data: { bookingId: id, urlToken: `tok-${id}`, amount: 10, expiresAt, used } });
    };
    const tag = ctx.agencyId.slice(0, 8);
    await mk(`qa-ex-${tag}-a`, "PAYMENT_PENDING", past);
    await mk(`qa-ex-${tag}-b`, "PAYMENT_PENDING", past);
    await mk(`qa-ex-${tag}-paid`, "PAID", past);            // moved on: must not be touched
    await mk(`qa-ex-${tag}-live`, "PAYMENT_PENDING", future); // window still open

    const slotsBefore = (await db.trekDepartureDate.findUniqueOrThrow({ where: { id: seed.departureDateId } })).bookedSlots;
    await expireUnpaidBookings();

    const status = async (s: string) => (await db.booking.findUniqueOrThrow({ where: { id: `qa-ex-${tag}-${s}` } })).status;
    expect(await status("a")).toBe("CANCELLED");
    expect(await status("b")).toBe("CANCELLED");
    expect(await status("paid")).toBe("PAID");
    expect(await status("live")).toBe("PAYMENT_PENDING");
    const slotsAfter = (await db.trekDepartureDate.findUniqueOrThrow({ where: { id: seed.departureDateId } })).bookedSlots;
    expect(slotsBefore - slotsAfter).toBe(2);
  });
});

d("Cron leader lock: exactly one process runs each tick (e2e)", () => {
  it("of 25 processes ticking at once, exactly one wins; a later tick inside the TTL still loses", async () => {
    const name = `qa-${randomUUID().slice(0, 8)}`;
    const results = await Promise.all(Array.from({ length: 25 }, () => acquireJobLock(name, 30)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await acquireJobLock(name, 30)).toBe(false); // not released on completion — see jobLock.ts
    await redis.del(`job-lock:${name}`);
    expect(await acquireJobLock(name, 30)).toBe(true);  // after the TTL/claim ends, the next tick can run
    await redis.del(`job-lock:${name}`);
  });
});
