import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma
const mockPrisma = {
  agency:       { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  subscription: { count: vi.fn() },
  invoice:      { aggregate: vi.fn() },
  trek:         { count: vi.fn() },
  booking:      { aggregate: vi.fn() },
  breakGlassToken: { create: vi.fn() },
};

vi.mock("../src/packages/database/prisma", () => ({ prisma: mockPrisma }));

// ── Mock Redis cache
let cacheStore: Record<string, any> = {};
vi.mock("../src/services/redis.service", () => ({
  cacheGet: vi.fn(async (k: string) => cacheStore[k] ?? null),
  cacheSet: vi.fn(async (k: string, v: any) => { cacheStore[k] = v; }),
  cacheDel: vi.fn(),
  TENANT_TTL: 300,
}));

import { getDashboardStats, issueBreakGlassToken } from "../src/services/admin.service";

describe("Admin dashboard", () => {

  beforeEach(() => {
    cacheStore = {};
    vi.clearAllMocks();
  });

  // dashboard state

  it("returns correct shape with all expected fields", async () => {
    mockPrisma.agency.groupBy.mockResolvedValue([
      { tier: "BASIC", _count: { _all: 10 } },
      { tier: "PRO",   _count: { _all: 5  } },
    ]);
    mockPrisma.subscription.count.mockResolvedValue(15);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { amount: 48320.50 } });
    mockPrisma.trek.count.mockResolvedValue(34);

    const stats: any = await getDashboardStats();

    expect(stats.agenciesByTier).toEqual({ BASIC: 10, PRO: 5 });
    expect(stats.totalActiveSubscriptions).toBe(15);
    expect(stats.revenueThisMonth).toBe(48320.50);
    expect(stats.activeTreksLive).toBe(34);
    expect(stats.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("revenueThisMonth defaults to 0 when _sum.amount is null", async () => {
    mockPrisma.agency.groupBy.mockResolvedValue([]);
    mockPrisma.subscription.count.mockResolvedValue(0);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { amount: null } });
    mockPrisma.trek.count.mockResolvedValue(0);

    const stats: any = await getDashboardStats();
    expect(stats.revenueThisMonth).toBe(0);
  });

  it("caches result — Prisma called only once on second request", async () => {
    mockPrisma.agency.groupBy.mockResolvedValue([]);
    mockPrisma.subscription.count.mockResolvedValue(0);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mockPrisma.trek.count.mockResolvedValue(0);

    await getDashboardStats(); // miss → DB
    await getDashboardStats(); // hit  → cache

    expect(mockPrisma.agency.groupBy).toHaveBeenCalledTimes(1);
    expect(mockPrisma.subscription.count).toHaveBeenCalledTimes(1);
  });

  it("invoice query filters by PAID status and start of current month", async () => {
    mockPrisma.agency.groupBy.mockResolvedValue([]);
    mockPrisma.subscription.count.mockResolvedValue(0);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mockPrisma.trek.count.mockResolvedValue(0);

    await getDashboardStats();

    const invoiceCall = mockPrisma.invoice.aggregate.mock.calls[0][0];
    expect(invoiceCall.where.status).toBe("PAID");
    expect(invoiceCall.where.paidAt.gte).toBeInstanceOf(Date);
  });

  it("trek query filters by LIVE status", async () => {
    mockPrisma.agency.groupBy.mockResolvedValue([]);
    mockPrisma.subscription.count.mockResolvedValue(0);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mockPrisma.trek.count.mockResolvedValue(0);

    await getDashboardStats();
    expect(mockPrisma.trek.count.mock.calls[0][0]).toEqual({ where: { status: "LIVE" } });
  });
});

describe("Break-glass token", () => {

  beforeEach(() => {
    cacheStore = {};
    vi.clearAllMocks();
  });

  // break-glass

  it("issues a 64-char hex token", async () => {
    const recordId = "bg_record_123";
    mockPrisma.breakGlassToken.create.mockResolvedValue({ id: recordId });
    mockPrisma.agency.findUnique.mockResolvedValue({ email: "a@b.com", name: "Test Agency" });

    const result: any = await issueBreakGlassToken("agency_xyz", "127.0.0.1");

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.recordId).toBe(recordId);
  });

  it("expiresAt is approximately 30 minutes from now", async () => {
    mockPrisma.breakGlassToken.create.mockResolvedValue({ id: "bg_1" });
    mockPrisma.agency.findUnique.mockResolvedValue({ email: "a@b.com", name: "Test" });

    const before = Date.now();
    const result: any = await issueBreakGlassToken("agency_xyz", "127.0.0.1");
    const after  = Date.now();

    const expiresMs = new Date(result.expiresAt).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 100);
    expect(expiresMs).toBeLessThanOrEqual(after  + 30 * 60 * 1000 + 100);
  });

  it("stores token in Redis with 1800s TTL", async () => {
    const { cacheSet } = await import("../src/services/redis.service");
    mockPrisma.breakGlassToken.create.mockResolvedValue({ id: "bg_2" });
    mockPrisma.agency.findUnique.mockResolvedValue({ email: "a@b.com", name: "Test" });

    const result: any = await issueBreakGlassToken("agency_xyz", "10.0.0.1");

    expect(cacheSet).toHaveBeenCalledWith(
      `break-glass:${result.token}`,
      { agencyId: "agency_xyz", issuedByIp: "10.0.0.1" },
      1800
    );
  });

  it("BreakGlassToken.create called with correct shape", async () => {
    mockPrisma.breakGlassToken.create.mockResolvedValue({ id: "bg_3" });
    mockPrisma.agency.findUnique.mockResolvedValue({ email: "a@b.com", name: "Test" });

    await issueBreakGlassToken("agency_abc", "192.168.1.1");

    const createArg = mockPrisma.breakGlassToken.create.mock.calls[0][0];
    expect(createArg.data.agencyId).toBe("agency_abc");
    expect(createArg.data.issuedByIp).toBe("192.168.1.1");
    expect(createArg.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(createArg.data.expiresAt).toBeInstanceOf(Date);
  });
});
