import { getAnalyticsCollection } from "../models/analyticsEvent.model";
import { prisma } from "../packages/database/prisma";
import { cacheGet, cacheSet } from "./redis.service";

const PLATFORM_CACHE_TTL = 300; // 5 minutes

// ── Overview ──────────────────────────────────────────────────────────────────

export async function getPlatformOverview() {
  const cacheKey = "platform:analytics:overview";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const col = await getAnalyticsCollection();
  const now  = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalBookings,
    monthlyBookings,
    totalRevenue,
    monthlyRevenue,
    activeAgencies,
    tierBreakdown,
    topDestinations,
  ] = await Promise.all([
    col.countDocuments({ event_type: "BOOKING_CONFIRMED" }),
    col.countDocuments({
      event_type: "BOOKING_CONFIRMED",
      timestamp:  { $gte: startOfMonth },
    }),
    col.aggregate([
      { $match: { event_type: "BOOKING_PAID" } },
      { $group: { _id: null, total: { $sum: "$metadata.amount" } } },
    ]).toArray(),
    col.aggregate([
      { $match: { event_type: "BOOKING_PAID", timestamp: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: "$metadata.amount" } } },
    ]).toArray(),
    prisma.agency.count({ where: { status: "ACTIVE" } }),
    prisma.agency.groupBy({ by: ["tier"], _count: { _all: true } }),
    col.aggregate([
      { $match: { event_type: "BOOKING_CONFIRMED" } },
      { $group: { _id: "$metadata.destination", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray(),
  ]);

  // Revenue by tier: join bookings with agency tier
  const revenueByTier = await col.aggregate([
    { $match: { event_type: "BOOKING_PAID" } },
    { $group: { _id: "$metadata.agency_tier", revenue: { $sum: "$metadata.amount" } } },
    { $sort: { revenue: -1 } },
  ]).toArray();

  const result = {
    generatedAt:      now.toISOString(),
    totalBookings,
    monthlyBookings,
    totalRevenue:     (totalRevenue[0] as { total?: number } | undefined)?.total ?? 0,
    monthlyRevenue:   (monthlyRevenue[0] as { total?: number } | undefined)?.total ?? 0,
    activeAgencies,
    agenciesByTier:   (tierBreakdown as Array<{ tier: string; _count: { _all: number } }>).reduce(
      (acc: Record<string, number>, row) => { acc[row.tier] = row._count._all; return acc; },
      {} as Record<string, number>
    ),
    revenueByTier:    revenueByTier.map((r) => ({
      tier:    (r as { _id: string })._id ?? "UNKNOWN",
      revenue: (r as { revenue: number }).revenue ?? 0,
    })),
    topDestinations:  topDestinations.map((d) => ({
      destination: (d as { _id: string })._id ?? "Unknown",
      bookings:    (d as { count: number }).count,
    })),
  };

  await cacheSet(cacheKey, result, PLATFORM_CACHE_TTL);
  return result;
}

// ── Agency performance ────────────────────────────────────────────────────────

export async function getAgencyPerformance() {
  const cacheKey = "platform:analytics:agencies";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const col = await getAnalyticsCollection();

  const [topByBookings, topByRevenue, topByRetention] = await Promise.all([
    col.aggregate([
      { $match: { event_type: "BOOKING_CONFIRMED" } },
      { $group: { _id: "$agency_id", bookings: { $sum: 1 } } },
      { $sort: { bookings: -1 } },
      { $limit: 10 },
    ]).toArray(),
    col.aggregate([
      { $match: { event_type: "BOOKING_PAID" } },
      { $group: { _id: "$agency_id", revenue: { $sum: "$metadata.amount" } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]).toArray(),
    col.aggregate([
      { $match: { event_type: "BOOKING_CONFIRMED" } },
      { $group: { _id: { agency: "$agency_id", trekker: "$trekker_id" }, count: { $sum: 1 } } },
      { $group: {
        _id:      "$_id.agency",
        total:    { $sum: 1 },
        returning: { $sum: { $cond: [{ $gt: ["$count", 1] }, 1, 0] } },
      }},
      { $addFields: { retentionRate: { $multiply: [{ $divide: ["$returning", "$total"] }, 100] } } },
      { $sort: { retentionRate: -1 } },
      { $limit: 10 },
    ]).toArray(),
  ]);

  const result = {
    generatedAt:    new Date().toISOString(),
    topByBookings:  topByBookings.map((a) => ({
      agency_id: (a as { _id: string })._id,
      bookings:  (a as { bookings: number }).bookings,
    })),
    topByRevenue:   topByRevenue.map((a) => ({
      agency_id: (a as { _id: string })._id,
      revenue:   (a as { revenue: number }).revenue,
    })),
    topByRetention: topByRetention.map((a) => ({
      agency_id:     (a as { _id: string })._id,
      retentionRate: Math.round((a as { retentionRate: number }).retentionRate * 10) / 10,
      totalCustomers:(a as { total: number }).total,
    })),
  };

  await cacheSet(cacheKey, result, PLATFORM_CACHE_TTL);
  return result;
}

// ── Marketplace analytics ─────────────────────────────────────────────────────

export async function getMarketplaceAnalytics() {
  const cacheKey = "platform:analytics:marketplace";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const col = await getAnalyticsCollection();

  const [topDestinations, popularFilters, funnelData] = await Promise.all([
    col.aggregate([
      { $match: { event_type: "PAGE_VIEW" } },
      { $group: { _id: "$metadata.destination", searches: { $sum: 1 } } },
      { $sort: { searches: -1 } },
      { $limit: 10 },
    ]).toArray(),
    col.aggregate([
      { $match: { event_type: "PAGE_VIEW", "metadata.filter": { $exists: true } } },
      { $group: { _id: "$metadata.filter", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray(),
    Promise.all([
      col.countDocuments({ event_type: "PAGE_VIEW" }),
      col.countDocuments({ event_type: "INQUIRY_SUBMITTED" }),
      col.countDocuments({ event_type: "BOOKING_CONFIRMED" }),
      col.countDocuments({ event_type: "BOOKING_PAID" }),
    ]),
  ]);

  const [views, inquiries, confirmed, paid] = funnelData;
  const result = {
    generatedAt:      new Date().toISOString(),
    topSearchedDestinations: topDestinations.map((d) => ({
      destination: (d as { _id: string })._id ?? "Unknown",
      searches:    (d as { searches: number }).searches,
    })),
    popularFilters: popularFilters.map((f) => ({
      filter: (f as { _id: string })._id ?? "Unknown",
      count:  (f as { count: number }).count,
    })),
    conversionFunnel: {
      pageViews:         views,
      inquiries,
      bookingsConfirmed: confirmed,
      bookingsPaid:      paid,
      viewToInquiryRate:   views > 0 ? Math.round((inquiries / views) * 100 * 10) / 10 : 0,
      inquiryToBookingRate: inquiries > 0 ? Math.round((confirmed / inquiries) * 100 * 10) / 10 : 0,
      bookingToPaymentRate: confirmed > 0 ? Math.round((paid / confirmed) * 100 * 10) / 10 : 0,
    },
  };

  await cacheSet(cacheKey, result, PLATFORM_CACHE_TTL);
  return result;
}

// ── Tier analytics ────────────────────────────────────────────────────────────

export async function getTierAnalytics() {
  const cacheKey = "platform:analytics:tiers";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [allAgencies, recentUpgrades, recentChurned] = await Promise.all([
    prisma.agency.groupBy({
      by: ["tier", "status"],
      _count: { _all: true },
    }),
    prisma.agency.findMany({
      where: {
        tier:      { not: "FREE" },
        updatedAt: { gte: thirtyDaysAgo },
        status:    "ACTIVE",
      },
      select: { id: true, tier: true, createdAt: true, updatedAt: true },
    }),
    prisma.agency.findMany({
      where: {
        status:    { in: ["SUSPENDED", "LOCKED"] },
        updatedAt: { gte: thirtyDaysAgo },
      },
      select: { id: true, tier: true, status: true, updatedAt: true },
    }),
  ]);

  // Build tier summary
  const tierMap: Record<string, { active: number; suspended: number; locked: number }> = {};
  for (const row of allAgencies as Array<{ tier: string; status: string; _count: { _all: number } }>) {
    if (!tierMap[row.tier]) tierMap[row.tier] = { active: 0, suspended: 0, locked: 0 };
    if (row.status === "ACTIVE")    tierMap[row.tier].active    += row._count._all;
    if (row.status === "SUSPENDED") tierMap[row.tier].suspended += row._count._all;
    if (row.status === "LOCKED")    tierMap[row.tier].locked    += row._count._all;
  }

  const trialToPaidRate = tierMap["FREE"]?.active > 0
    ? Math.round((recentUpgrades.length / tierMap["FREE"].active) * 100 * 10) / 10
    : 0;

  const totalActive = Object.values(tierMap).reduce((s, t) => s + t.active, 0);
  const churnRate   = totalActive > 0
    ? Math.round((recentChurned.length / totalActive) * 100 * 10) / 10
    : 0;

  const result = {
    generatedAt:      now.toISOString(),
    tierBreakdown:    tierMap,
    trialToPaidRate,
    recentUpgrades:   recentUpgrades.length,
    churnRate,
    recentChurned:    recentChurned.length,
    churnByTier:      recentChurned.reduce((acc: Record<string, number>, a) => {
      acc[a.tier] = (acc[a.tier] ?? 0) + 1;
      return acc;
    }, {}),
  };

  await cacheSet(cacheKey, result, PLATFORM_CACHE_TTL);
  return result;
}
