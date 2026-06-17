import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock audit collection (mongo) ──────────────────────────────────────────────
const { auditInsertOne } = vi.hoisted(() => ({
  auditInsertOne: vi.fn().mockResolvedValue({ insertedId: "audit_1" }),
}));

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      insertOne:   auditInsertOne,
      find:        vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) }),
      createIndex: vi.fn().mockResolvedValue("ok"),
    }),
  }),
}));

// ── Mock Prisma ───────────────────────────────────────────────────────────────
vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    agency: {
      count:      vi.fn().mockResolvedValue(0),
      findMany:   vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    booking:       { aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { totalAmount: null } }) },
    invoice:       { aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } }) },
    kYCSubmission: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

// ── Mock Redis ────────────────────────────────────────────────────────────────
const { cacheSetMock } = vi.hoisted(() => ({ cacheSetMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/services/redis.service", () => ({
  cacheSet: cacheSetMock,
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheDel: vi.fn(),
}));

import {
  listAgencies,
  getAgencyProfile,
  updateAgencyTier,
  updateAgencyStatus,
  issueImpersonationToken,
} from "../src/services/adminAgency.service";
import { writeAuditLog } from "../src/services/auditLog.service";
import { prisma } from "../src/packages/database/prisma";

describe("listAgencies()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies pagination defaults", async () => {
    vi.mocked(prisma.agency.count).mockResolvedValue(0);
    vi.mocked(prisma.agency.findMany).mockResolvedValue([] as never);
    const result = await listAgencies({});
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
  });

  it("builds search OR filter", async () => {
    vi.mocked(prisma.agency.count).mockResolvedValue(0);
    vi.mocked(prisma.agency.findMany).mockResolvedValue([] as never);
    await listAgencies({ search: "everest" });
    const call = vi.mocked(prisma.agency.findMany).mock.calls[0][0] as Record<string, unknown>;
    const where = call.where as Record<string, unknown>;
    expect(where.OR).toBeDefined();
  });

  it("builds date-joined range filter", async () => {
    vi.mocked(prisma.agency.count).mockResolvedValue(0);
    vi.mocked(prisma.agency.findMany).mockResolvedValue([] as never);
    await listAgencies({ joinedFrom: "2024-01-01", joinedTo: "2024-12-31" });
    const call = vi.mocked(prisma.agency.findMany).mock.calls[0][0] as Record<string, unknown>;
    const where = call.where as Record<string, unknown>;
    expect(where.createdAt).toBeDefined();
  });

  it("caps limit at 100", async () => {
    vi.mocked(prisma.agency.count).mockResolvedValue(0);
    vi.mocked(prisma.agency.findMany).mockResolvedValue([] as never);
    const result = await listAgencies({ limit: 500 });
    expect(result.meta.limit).toBe(100);
  });
});

describe("getAgencyProfile()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for unknown agency", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue(null);
    const result = await getAgencyProfile("missing");
    expect(result).toBeNull();
  });

  it("includes staffCount, bookingCount, kycStatus", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({
      id: "a1", name: "Test", _count: { bookings: 5, agencyUsers: 3 },
    } as never);
    const result = await getAgencyProfile("a1") as Record<string, unknown>;
    expect(result.staffCount).toBe(3);
    expect(result).toHaveProperty("bookingCount");
    expect(result).toHaveProperty("kycStatus");
  });
});

describe("updateAgencyTier()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates tier immediately", async () => {
    vi.mocked(prisma.agency.update).mockResolvedValue({ id: "a1", tier: "LARGE" } as never);
    const result = await updateAgencyTier("a1", "LARGE") as Record<string, unknown>;
    expect(result.tier).toBe("LARGE");
  });
});

describe("updateAgencyStatus()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves status with reason", async () => {
    vi.mocked(prisma.agency.update).mockResolvedValue({
      id: "a1", status: "SUSPENDED", statusReason: "fraud", statusUpdatedAt: new Date(),
    } as never);
    const result = await updateAgencyStatus("a1", "SUSPENDED", "fraud") as Record<string, unknown>;
    expect(result.status).toBe("SUSPENDED");
    expect(result.statusReason).toBe("fraud");
  });
});

describe("issueImpersonationToken()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues a 64-char hex token stored in Redis", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ id: "a1", name: "Test", email: "t@a.com" } as never);
    const result = await issueImpersonationToken("a1", "admin_1") as Record<string, unknown>;
    expect(result.token as string).toMatch(/^[0-9a-f]{64}$/);
    expect(result.agencyId).toBe("a1");
    expect(cacheSetMock).toHaveBeenCalled();
  });

  it("stores token with 15-minute TTL", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ id: "a1", name: "Test", email: "t@a.com" } as never);
    const result = await issueImpersonationToken("a1", "admin_1") as Record<string, unknown>;
    expect(result.ttlSeconds).toBe(900);
    const call = cacheSetMock.mock.calls[0];
    expect(call[2]).toBe(900);
  });

  it("throws if agency not found", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue(null);
    await expect(issueImpersonationToken("missing", "admin_1")).rejects.toThrow("not found");
  });
});

describe("writeAuditLog()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts an audit entry with correct shape", async () => {
    await writeAuditLog({
      action: "AGENCY_STATUS_CHANGED", actor_id: "admin_1", actor_ip: "127.0.0.1",
      target_type: "agency", target_id: "a1", reason: "fraud",
      metadata: { newStatus: "SUSPENDED" },
    });
    expect(auditInsertOne).toHaveBeenCalledOnce();
    const entry = auditInsertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.action).toBe("AGENCY_STATUS_CHANGED");
    expect(entry.actor_id).toBe("admin_1");
    expect(entry.target_id).toBe("a1");
    expect(entry.reason).toBe("fraud");
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it("defaults reason to null when not provided", async () => {
    await writeAuditLog({
      action: "AGENCY_VIEWED", actor_id: "admin_1", actor_ip: "127.0.0.1",
      target_type: "agency", target_id: "a1",
    });
    const entry = auditInsertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.reason).toBeNull();
  });

  it("never throws even if mongo fails", async () => {
    auditInsertOne.mockRejectedValueOnce(new Error("mongo down"));
    await expect(writeAuditLog({
      action: "AGENCY_VIEWED", actor_id: "admin_1", actor_ip: "127.0.0.1",
      target_type: "agency", target_id: "a1",
    })).resolves.not.toThrow();
  });
});
