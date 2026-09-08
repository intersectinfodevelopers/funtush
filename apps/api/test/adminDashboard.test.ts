import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    agency:          { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    subscription:    { count: vi.fn() },
    invoice:         { aggregate: vi.fn() },
    trek:            { count: vi.fn() },
    booking:         { aggregate: vi.fn() },
    breakGlassToken: { create: vi.fn() },
  },
}));

// ── Mock Redis cache ──────────────────────────────────────────────────────────
let cacheStore: Record<string, unknown> = {};
vi.mock("../src/services/redis.service", () => ({
  cacheGet: vi.fn(async (k: string) => cacheStore[k] ?? null),
  cacheSet: vi.fn(async (k: string, v: unknown) => { cacheStore[k] = v; }),
  cacheDel: vi.fn(),
  TENANT_TTL: 300,
}));

import { getDashboardStats, issueBreakGlassToken } from "../src/services/admin.service";
import { prisma } from "../src/packages/database/prisma";

describe("Admin dashboard", () => {

  beforeEach(() => {
    cacheStore = {};
    vi.clearAllMocks();
  });

  it("returns correct shape with all expected fields", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([
      { tier: "BASIC", _count: { _all: 10 } },
      { tier: "PRO",   _count: { _all: 5  } },
    ] as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(15);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({ _sum: { amount: 48320.50 } } as never);
    vi.mocked(prisma.trek.count).mockResolvedValue(34);

    const stats = await getDashboardStats() as Record<string, unknown>;

    expect(stats.agenciesByTier).toEqual({ BASIC: 10, PRO: 5 });
    expect(stats.totalActiveSubscriptions).toBe(15);
    expect(stats.revenueThisMonth).toBe(48320.50);
    expect(stats.activeTreksLive).toBe(34);
    expect(stats.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("revenueThisMonth defaults to 0 when _sum.amount is null", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({ _sum: { amount: null } } as never);
    vi.mocked(prisma.trek.count).mockResolvedValue(0);

    const stats = await getDashboardStats() as Record<string, unknown>;
    expect(stats.revenueThisMonth).toBe(0);
  });

  it("caches result — Prisma called only once on second request", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as never);
    vi.mocked(prisma.trek.count).mockResolvedValue(0);

    await getDashboardStats();
    await getDashboardStats();

    expect(prisma.agency.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.count).toHaveBeenCalledTimes(1);
  });

  it("invoice query filters by PAID status and start of current month", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as never);
    vi.mocked(prisma.trek.count).mockResolvedValue(0);

    await getDashboardStats();

    const invoiceCall = vi.mocked(prisma.invoice.aggregate).mock.calls[0][0] as Record<string, unknown>;
    const where = invoiceCall.where as Record<string, unknown>;
    expect(where.status).toBe("PAID");
    expect((where.paidAt as Record<string, unknown>).gte).toBeInstanceOf(Date);
  });

  it("trek query filters by LIVE status", async () => {
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as never);
    vi.mocked(prisma.trek.count).mockResolvedValue(0);

    await getDashboardStats();
    expect(vi.mocked(prisma.trek.count).mock.calls[0][0]).toEqual({ where: { status: "LIVE" } });
  });
});

describe("Break-glass token", () => {

  beforeEach(() => {
    cacheStore = {};
    vi.clearAllMocks();
  });

  it("issues a 64-char hex token", async () => {
    vi.mocked(prisma.breakGlassToken.create).mockResolvedValue({ id: "bg_record_123" } as never);
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ email: "a@b.com", name: "Test Agency" } as never);

    const result = await issueBreakGlassToken("agency_xyz", "127.0.0.1") as Record<string, unknown>;
    expect(result.token as string).toMatch(/^[0-9a-f]{64}$/);
    expect(result.recordId).toBe("bg_record_123");
  });

  it("expiresAt is approximately 30 minutes from now", async () => {
    vi.mocked(prisma.breakGlassToken.create).mockResolvedValue({ id: "bg_1" } as never);
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ email: "a@b.com", name: "Test" } as never);

    const before = Date.now();
    const result = await issueBreakGlassToken("agency_xyz", "127.0.0.1") as Record<string, unknown>;
    const after  = Date.now();

    const expiresMs = new Date(result.expiresAt as string).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 100);
    expect(expiresMs).toBeLessThanOrEqual(after  + 30 * 60 * 1000 + 100);
  });

  it("stores token in Redis with 1800s TTL", async () => {
    const { cacheSet } = await import("../src/services/redis.service");
    vi.mocked(prisma.breakGlassToken.create).mockResolvedValue({ id: "bg_2" } as never);
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ email: "a@b.com", name: "Test" } as never);

    const result = await issueBreakGlassToken("agency_xyz", "10.0.0.1") as Record<string, unknown>;
    expect(cacheSet).toHaveBeenCalledWith(
      `break-glass:${result.token}`,
      { agencyId: "agency_xyz", issuedByIp: "10.0.0.1" },
      1800
    );
  });

  it("BreakGlassToken.create called with correct shape", async () => {
    vi.mocked(prisma.breakGlassToken.create).mockResolvedValue({ id: "bg_3" } as never);
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ email: "a@b.com", name: "Test" } as never);

    await issueBreakGlassToken("agency_abc", "192.168.1.1");

    const createArg = vi.mocked(prisma.breakGlassToken.create).mock.calls[0][0] as Record<string, unknown>;
    const data = createArg.data as Record<string, unknown>;
    expect(data.agencyId).toBe("agency_abc");
    expect(data.issuedByIp).toBe("192.168.1.1");
    expect(data.token as string).toMatch(/^[0-9a-f]{64}$/);
    expect(data.expiresAt).toBeInstanceOf(Date);
  });
});
