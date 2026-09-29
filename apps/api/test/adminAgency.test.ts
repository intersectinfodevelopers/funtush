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
// IMPORTANT: mock the same specifier the service imports ("@funtush/database"),
// not the internal relative path — otherwise vitest never intercepts the real
// client and the service hits a live (unmocked) Prisma instance.
vi.mock("@funtush/database", () => ({
  prisma: {
    agency: {
      count:      vi.fn().mockResolvedValue(0),
      findMany:   vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    agencyUser: {
      findFirst: vi.fn(),
    },
    subscriptionTier: {
      findUnique: vi.fn().mockResolvedValue({ id: "tier_large" }),
    },
    // NOTE: lowercase "k" — matches prisma.kycSubmission in the service.
    // The old mock used `kYCSubmission`, which silently never got hit.
    kycSubmission: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    booking: {
      // NOTE: service reads `_sum.totalPrice`, not `_sum.totalAmount`.
      aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { totalPrice: null } }),
    },
    invoice: {
      aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } }),
    },
  },
}));

// ── Mock Redis ────────────────────────────────────────────────────────────────
const { cacheSetMock } = vi.hoisted(() => ({ cacheSetMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/services/redis.service", () => ({
  cacheSet: cacheSetMock,
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheDel: vi.fn(),
}));

import jwt from "jsonwebtoken";
import {
  listAgencies,
  getAgencyProfile,
  updateAgencyTier,
  updateAgencyStatus,
  impersonateAgency,
} from "../src/services/adminAgency.service";
import { writeAuditLog } from "../src/services/auditLog.service";
import { prisma } from "@funtush/database";

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
      // NOTE: service selects `_count: { bookings, users }` (relation is
      // `users`, not `agencyUsers`) and reads `_count.users` for staffCount.
      id: "a1", name: "Test", _count: { bookings: 5, users: 3 },
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
    vi.mocked(prisma.subscriptionTier.findUnique).mockResolvedValue({ id: "tier_large" } as never);
    vi.mocked(prisma.agency.update).mockResolvedValue({ id: "a1", tier: { name: "LARGE" } } as never);
    const result = await updateAgencyTier("a1", "LARGE") as Record<string, unknown>;
    const tier = result.tier as Record<string, unknown>;
    expect(tier.name).toBe("LARGE");
  });

  it("throws for an unknown tier", async () => {
    vi.mocked(prisma.subscriptionTier.findUnique).mockResolvedValue(null);
    await expect(updateAgencyTier("a1", "NOT_A_TIER")).rejects.toThrow("Unknown tier");
  });
});

describe("updateAgencyStatus()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves status with reason", async () => {
    vi.mocked(prisma.agency.update).mockResolvedValue({
      id: "a1", status: "SUSPENDED", statusReason: "fraud", statusUpdatedAt: new Date(),
    } as never);
    const result = await updateAgencyStatus("a1", "SUSPENDED") as Record<string, unknown>;
    expect(result.status).toBe("SUSPENDED");
    expect(result.statusReason).toBe("fraud");
  });
});

describe("impersonateAgency()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues a real accessToken/refreshToken pair for the agency's primary AGENCY_ADMIN user", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ id: "a1", name: "Test", email: "t@a.com", status: "ACTIVE" } as never);
    vi.mocked(prisma.agencyUser.findFirst).mockResolvedValue({ user: { id: "owner_1", email: "owner@a.com" } } as never);

    const result = await impersonateAgency("a1", "admin_1") as Record<string, unknown>;

    expect(result.agencyId).toBe("a1");
    expect(result.impersonatedUserId).toBe("owner_1");
    expect(result.impersonatedEmail).toBe("owner@a.com");
    expect(result.ttlSeconds).toBe(3600);

    // Real, verifiable JWTs — not an opaque cache-only token nothing can
    // exchange for anything (what this function replaced).
    const access = jwt.verify(result.accessToken as string, process.env.JWT_ACCESS_SECRET as string) as jwt.JwtPayload;
    expect(access.userId).toBe("owner_1");
    expect(access.agencyId).toBe("a1");
    expect(access.role).toBe("AGENCY_ADMIN");
    expect(access.roleType).toBe("TENANT");

    const refresh = jwt.verify(result.refreshToken as string, process.env.JWT_REFRESH_SECRET as string) as jwt.JwtPayload;
    expect(refresh.userId).toBe("owner_1");
    // ~1 hour, not the normal 7-day refresh-token lifetime.
    expect(refresh.exp! - refresh.iat!).toBe(3600);
  });

  it("throws if the agency is not found", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue(null);
    await expect(impersonateAgency("missing", "admin_1")).rejects.toThrow("not found");
  });

  it("throws if the agency is banned", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ id: "a1", name: "Test", email: "t@a.com", status: "BANNED" } as never);
    await expect(impersonateAgency("a1", "admin_1")).rejects.toThrow("banned");
  });

  it("throws if the agency has no AGENCY_ADMIN user", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ id: "a1", name: "Test", email: "t@a.com", status: "ACTIVE" } as never);
    vi.mocked(prisma.agencyUser.findFirst).mockResolvedValue(null);
    await expect(impersonateAgency("a1", "admin_1")).rejects.toThrow("no AGENCY_ADMIN user");
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