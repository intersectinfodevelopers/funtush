import { prisma } from "@funtush/database";
import crypto from "crypto";
import { cacheSet } from "./redis.service";
import { calculateAndPersistVisibilityScore } from "./visibility.service";
import { reindexAgencyPackages } from "./search.service";


export interface AgencyListFilter {
  tier?:       string;  
  status?:     string;  // AgencyStatus enum value
  search?:     string;
  joinedFrom?: string;  
  joinedTo?:   string;
  page?:       number;
  limit?:      number;
}

export async function listAgencies(filters: AgencyListFilter) {
  const page  = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const skip  = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.tier)   where.tier   = { name: filters.tier };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    where.OR = [
      { name:  { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  if (filters.joinedFrom || filters.joinedTo) {
    const createdAt: Record<string, Date> = {};
    if (filters.joinedFrom) createdAt.gte = new Date(`${filters.joinedFrom}T00:00:00.000Z`);
    if (filters.joinedTo)   createdAt.lte = new Date(`${filters.joinedTo}T23:59:59.999Z`);
    where.createdAt = createdAt;
  }

  const [total, agencies] = await Promise.all([
    prisma.agency.count({ where }),
    prisma.agency.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true,
        tier: { select: { name: true } },
        status: true, createdAt: true, slug: true,
      },
    }),
  ]);

  return {
    data: agencies,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

// Full agency profile 
export async function getAgencyProfile(id: string) {
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
      subscriptions: true,
      _count: { select: { bookings: true, users: true } }, // FIX: relation is `users`, not `agencyUsers`
    },
  });
  if (!agency) return null;

  const [bookingSummary, kyc] = await Promise.all([
    prisma.booking.aggregate({
      _count: { _all: true },
      _sum:   { totalPrice: true }, // FIX: field is `totalPrice`, not `totalAmount`
      where:  { agencyId: id },
    }),
    prisma.kycSubmission.findUnique({
      where:  { agencyId: id },
      select: { status: true, submittedAt: true, reviewedAt: true },
    }),
  ]);

  return {
    ...agency,
    staffCount:    (agency as unknown as { _count: { users: number } })._count.users,
    bookingCount:  bookingSummary._count._all,
    bookingSummary: {
      totalBookings: bookingSummary._count._all,
      totalRevenue:  bookingSummary._sum.totalPrice ?? 0,
    },
    kycStatus: kyc?.status ?? "NONE",
  };
}

// Change tier (immediate) 
export async function updateAgencyTier(id: string, tierName: string) {

  const tier = await prisma.subscriptionTier.findUnique({
    where: { name: tierName },
    select: { id: true },
  });
  if (!tier) throw new Error(`Unknown tier: ${tierName}`);

  return prisma.agency.update({
    where: { id },
    data:  { tierId: tier.id },
    select: { id: true, tier: { select: { name: true } } },
  });
}

// Change status
export async function updateAgencyStatus(
  id: string,
  status: "ACTIVE" | "SUSPENDED" | "LOCKED"
) {
  return prisma.agency.update({
    where: { id },
    data:  { status },
    select: { id: true, status: true },
  });
}

const IMPERSONATE_TTL_SECONDS = 15 * 60; // 15 minutes

export async function issueImpersonationToken(agencyId: string, adminId: string) {
  const agency = await prisma.agency.findUnique({
    where:  { id: agencyId },
    select: { id: true, name: true, email: true },
  });
  if (!agency) throw new Error("Agency not found");

  const token     = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + IMPERSONATE_TTL_SECONDS * 1000);

  await cacheSet(
    `impersonate:${token}`,
    { agencyId, adminId, issuedAt: new Date().toISOString() },
    IMPERSONATE_TTL_SECONDS
  );

  return { token, expiresAt: expiresAt.toISOString(), agencyId, ttlSeconds: IMPERSONATE_TTL_SECONDS };
}

export { IMPERSONATE_TTL_SECONDS };

export interface PriorityOverrideResult {
  agencyId: string;
  priorityOverride: number;
  finalScore: number;
  sponsored: boolean;
}

export async function updateAgencyPriorityOverride(
  agencyId: string,
  priorityOverride: number
): Promise<PriorityOverrideResult> {
  if (!Number.isInteger(priorityOverride) || priorityOverride < 0) {
    throw new Error("priorityOverride must be a non-negative integer");
  }

  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { id: true },
  });
  if (!agency) throw new Error("Agency not found");

  await prisma.agency.update({
    where: { id: agencyId },
    data: { priorityOverride },
  });

  // Recompute base + quality + NEW override, persist immediately.
  const scoreResult = await calculateAndPersistVisibilityScore(agencyId);

  await reindexAgencyPackages(agencyId);

  return {
    agencyId,
    priorityOverride,
    finalScore: scoreResult.finalScore,
    sponsored: priorityOverride > 0,
  };
}