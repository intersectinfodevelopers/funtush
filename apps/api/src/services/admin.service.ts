import { db } from "@funtush/database";
import { prisma } from "../packages/database/prisma.js";
import { cacheGet, cacheSet } from "./redis.service.js";
import crypto from "crypto";

const DASHBOARD_TTL = 60;



export async function getDashboardStats() {
  const cacheKey = "admin:dashboard";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [agenciesByTier, activeSubscriptions, monthlyRevenue, activeTreks] =
    await Promise.all([

      prisma.agency.groupBy({
        by: ["tier"],
        _count: { _all: true },
      }),

      prisma.subscription.count({
        where: { status: "ACTIVE" },
      }),


      prisma.invoice.aggregate({
        _sum: { amount: true },
        where: {
          status: "PAID",
          paidAt: { gte: startOfMonth },
        },
      }),


      prisma.trek.count({
        where: { status: "LIVE" },
      }),
    ]);

  const stats = {
    agenciesByTier: (agenciesByTier as Array<{ tier: string; _count: { _all: number } }>).reduce((acc: Record<string, number>, row) => {
      acc[row.tier] = row._count._all;
      return acc;
    }, {} as Record<string, number>),
    totalActiveSubscriptions: activeSubscriptions,
    revenueThisMonth: monthlyRevenue._sum.amount ?? 0,
    activeTreksLive: activeTreks,
    generatedAt: now.toISOString(),
  };

  await cacheSet(cacheKey, stats, DASHBOARD_TTL);
  return stats;
}


export interface AgencyListFilter {
  tier?: string;
  status?: string;
  country?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listAgencies(filters: AgencyListFilter) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.tier) where.tier = filters.tier;
  if (filters.status) where.status = filters.status;
  if (filters.country) where.country = filters.country;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
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
        status: true, country: true, createdAt: true,
        slug: true,
      },
    }),
  ]);

  return {
    data: agencies,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}



export async function getAgencyProfile(id: string) {
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
      subscription: true,
      domainMappings: true,
      settings: true,
      _count: {
        select: { bookings: true, treks: true },
      },
    },
  });

  if (!agency) return null;

  const [bookingSummary, financialSummary] = await Promise.all([
    prisma.booking.aggregate({
      _count: { _all: true },
      _sum: { totalAmount: true },
      where: { agencyId: id },
    }),
    prisma.invoice.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: { agencyId: id, status: "PAID" },
    }),
  ]);

  return {
    ...agency,
    bookingSummary: {
      totalBookings: bookingSummary._count._all,
      totalRevenue: bookingSummary._sum.totalAmount ?? 0,
    },
    financialSummary: {
      totalInvoicesPaid: financialSummary._count._all,
      totalPaidAmount: financialSummary._sum.amount ?? 0,
    },
  };
}


export async function updateAgencyStatus(
  id: string,
  status: "ACTIVE" | "SUSPENDED" | "LOCKED",
  reason: string
) {
  return prisma.agency.update({
    where: { id },
    data: {
      status,
      statusReason: reason,
      statusUpdatedAt: new Date(),
    },
    select: { id: true, status: true, statusReason: true, statusUpdatedAt: true },
  });
}


export async function updateAgencyTier(id: string, tier: string) {
  return prisma.agency.update({
    where: { id },
    data: { tier },
    select: { id: true, tier: true },
  });
}

const BREAK_GLASS_TTL_SECONDS = 30 * 60;

export async function issueBreakGlassToken(agencyId: string, issuedByIp: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + BREAK_GLASS_TTL_SECONDS * 1000);


  const record = await prisma.breakGlassToken.create({
    data: {
      token,
      agencyId,
      issuedByIp,
      expiresAt,
    },
  });


  await cacheSet(`break-glass:${token}`, { agencyId, issuedByIp }, BREAK_GLASS_TTL_SECONDS);


  notifyAgencyAdminOfBreakGlass(agencyId, expiresAt).catch((err) =>
    console.error("[break-glass] notification failed:", err)
  );

  return { token, expiresAt, recordId: record.id };
}

async function notifyAgencyAdminOfBreakGlass(agencyId: string, expiresAt: Date) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { email: true, name: true },
  });
  if (!agency) return;

  console.log(
    `[break-glass] NOTIFY ${agency.email}: Emergency access granted to ${agency.name} — expires ${expiresAt.toISOString()}`
  );
}


export const getFlaggedAgencyService = async () => {
  const flaggedReviews = await db.reviewFlag.findMany({
    include: {
      review: {
        include: {
          trekker: {
            select: {
              fullName: true,
            },
          },
          agency: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return {
    flaggedReviews
  }
}

export const removeReviewWithContentViolation = async (reviewId: string) => {

  const review = await db.review.findUnique({
    where: {
      id: reviewId,
    },
  });

  if (!review) {
    throw new Error("Review not found");
  }

  await db.review.delete({
    where: {
      id: reviewId,
    },
  });

  return {
    message: "Review removed successfully",
  };

};


export const dismissFlagService = async (reviewId: string) => {

  const review = await db.review.findUnique({
    where: {
      id: reviewId,
    },
  });

  if (!review) {
    throw new Error("Review not found");
  }

  await db.reviewFlag.updateMany({
    where: {
      reviewId,
      status: "PENDING",
    },
    data: {
      status: "DISMISSED"
    },
  });

  return {
    message: "Flag dismissed. Review remains published.",
  };

}