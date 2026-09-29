import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    agency:           { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn(), count: vi.fn().mockResolvedValue(0), findUnique: vi.fn(), update: vi.fn() },
    kycSubmission:    { groupBy: vi.fn().mockResolvedValue([]) },
    subscriptionTier: { findMany: vi.fn().mockResolvedValue([]) },
    subscription:     { count: vi.fn() },
    trekkerInvoice:   { aggregate: vi.fn() },
    trekPackage:      { count: vi.fn() },
    booking:          { aggregate: vi.fn() },
    breakGlassToken:  { create: vi.fn() },
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
    vi.mocked(prisma.subscriptionTier.findMany).mockResolvedValue([
      { name: "FREE", _count: { agencies: 10 } },
      { name: "PRO",  _count: { agencies: 5  } },
    ] as never);
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([
      { status: "TRIAL", _count: { _all: 2 } },
      { status: "ACTIVE", _count: { _all: 13 } },
    ] as never);
    vi.mocked(prisma.kycSubmission.groupBy).mockResolvedValue([
      { status: "APPROVED", _count: { _all: 7 } },
    ] as never);
    vi.mocked(prisma.agency.count).mockResolvedValueOnce(3).mockResolvedValueOnce(15);

    const stats = await getDashboardStats() as Record<string, unknown>;

    expect(stats.totalAgencies).toBe(15);
    expect(stats.agenciesOnTrial).toBe(2);
    expect(stats.agenciesOnPaidPlan).toBe(5);
    expect(stats.kycVerified).toBe(7);
    expect(stats.kycByStatus).toMatchObject({ NOT_SUBMITTED: 3, APPROVED: 7 });
    expect(stats.agenciesByTier).toEqual({ FREE: 10, PRO: 5 });
    expect(stats.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("defaults lifecycle and KYC counts to 0 when there is no data", async () => {
    vi.mocked(prisma.subscriptionTier.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agency.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.kycSubmission.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.agency.count).mockResolvedValue(0);

    const stats = await getDashboardStats() as Record<string, unknown>;
    expect(stats.agenciesOnTrial).toBe(0);
    expect(stats.agenciesOnPaidPlan).toBe(0);
    expect(stats.kycVerified).toBe(0);
    expect(stats.kycByStatus).toMatchObject({ NOT_SUBMITTED: 0, APPROVED: 0 });
  });

  it("caches result — Prisma called only once on second request", async () => {
    await getDashboardStats();
    await getDashboardStats();

    expect(prisma.agency.count).toHaveBeenCalledTimes(2);
    expect(prisma.kycSubmission.groupBy).toHaveBeenCalledTimes(1);
  });

  it("groups agency and KYC submissions by status", async () => {
    await getDashboardStats();

    expect(prisma.agency.groupBy).toHaveBeenCalledWith({ by: ["status"], _count: { _all: true } });
    expect(prisma.kycSubmission.groupBy).toHaveBeenCalledWith({ by: ["status"], _count: { _all: true } });
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
