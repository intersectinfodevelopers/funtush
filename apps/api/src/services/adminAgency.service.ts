import { prisma } from "../packages/database/prisma";
import crypto from "crypto";
import { cacheSet } from "./redis.service";

// ── List agencies with filters + pagination ────────────────────────────────────

export interface AgencyListFilter {
  tier?:       string;
  status?:     string;
  country?:    string;
  search?:     string;
  joinedFrom?: string;  // YYYY-MM-DD
  joinedTo?:   string;
  page?:       number;
  limit?:      number;
}

export async function listAgencies(filters: AgencyListFilter) {
  const page  = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const skip  = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.tier)    where.tier    = filters.tier;
  if (filters.status)  where.status  = filters.status;
  if (filters.country) where.country = filters.country;
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
        id: true, name: true, email: true, tier: true,
        status: true, country: true, createdAt: true, slug: true,
      },
    }),
  ]);

  return {
    data: agencies,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

// ── Full agency profile ─────────────────────────────────────────────────────────

export async function getAgencyProfile(id: string) {
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
      subscription:   true,
      settings:       true,
      _count: { select: { bookings: true, agencyUsers: true } },
    },
  });
  if (!agency) return null;

  const [bookingSummary, financialSummary, kyc] = await Promise.all([
    prisma.booking.aggregate({
      _count: { _all: true },
      _sum:   { totalAmount: true },
      where:  { agencyId: id },
    }),
    prisma.invoice.aggregate({
      _sum:   { amount: true },
      _count: { _all: true },
      where:  { agencyId: id, status: "PAID" },
    }),
    prisma.kYCSubmission.findFirst({
      where:   { agencyId: id },
      orderBy: { submittedAt: "desc" },
      select:  { status: true, submittedAt: true, reviewedAt: true },
    }),
  ]);

  return {
    ...agency,
    staffCount:    (agency as unknown as { _count: { agencyUsers: number } })._count.agencyUsers,
    bookingCount:  bookingSummary._count._all,
    bookingSummary: {
      totalBookings: bookingSummary._count._all,
      totalRevenue:  bookingSummary._sum.totalAmount ?? 0,
    },
    financialSummary: {
      totalInvoicesPaid: financialSummary._count._all,
      totalPaidAmount:   financialSummary._sum.amount ?? 0,
    },
    kycStatus: kyc?.status ?? "NONE",
  };
}

// ── Change tier (immediate) ──────────────────────────────────────────────────

export async function updateAgencyTier(id: string, tier: string) {
  return prisma.agency.update({
    where: { id },
    data:  { tier },
    select: { id: true, tier: true },
  });
}

// ── Change status (with mandatory reason) ──────────────────────────────────────

export async function updateAgencyStatus(
  id: string,
  status: "ACTIVE" | "SUSPENDED" | "LOCKED",
  reason: string
) {
  return prisma.agency.update({
    where: { id },
    data:  { status, statusReason: reason, statusUpdatedAt: new Date() },
    select: { id: true, status: true, statusReason: true, statusUpdatedAt: true },
  });
}

// ── Impersonation token (short-lived) ──────────────────────────────────────────

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
