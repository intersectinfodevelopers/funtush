import { getAnalyticsCollection } from "../models/analyticsEvent.model";
import { prisma } from "../packages/database/prisma";
import { BookingStatus } from "@funtush/database";
import { cacheGet, cacheSet } from "./redis.service";

const PLATFORM_CACHE_TTL = 300; // 5 minutes

// ── Tier helpers ──────────────────────────────────────────────────────────────

/** Tier id → name (a handful of rows). */
async function tierNames(): Promise<Map<string, string>> {
  const tiers = await prisma.subscriptionTier.findMany({ select: { id: true, name: true } });
  return new Map(tiers.map((t) => [t.id, t.name]));
}

/** Agencies per tier via GROUP BY — never loads the agency table into memory. */
async function tierCounts(): Promise<Record<string, number>> {
  const [groups, names] = await Promise.all([
    prisma.agency.groupBy({ by: ["tierId"], _count: { _all: true } }),
    tierNames(),
  ]);
  const out: Record<string, number> = {};
  for (const g of groups) {
    const name = names.get(g.tierId) ?? "UNKNOWN";
    out[name] = (out[name] ?? 0) + g._count._all;
  }
  return out;
}

/** Sum a per-agency value into per-tier totals (agencies since deleted fall into UNKNOWN), biggest first. */
async function sumByTier(rows: Array<{ agencyId: string; value: number }>): Promise<Array<{ tier: string; value: number }>> {
  if (rows.length === 0) return [];
  const agencies = await prisma.agency.findMany({
    where: { id: { in: rows.map((r) => r.agencyId) } },
    select: { id: true, tier: { select: { name: true } } },
  });
  const tierOf = new Map(agencies.map((a) => [a.id, a.tier?.name ?? "UNKNOWN"]));
  const totals = new Map<string, number>();
  for (const r of rows) {
    const t = tierOf.get(r.agencyId) ?? "UNKNOWN";
    totals.set(t, (totals.get(t) ?? 0) + r.value);
  }
  return [...totals].map(([tier, value]) => ({ tier, value })).sort((a, b) => b.value - a.value);
}

// ── Overview ──────────────────────────────────────────────────────────────────

// A booking that reached PAID (or further) is real money that moved. CONFIRMED
// alone isn't included — that's still a reservation with no payment behind it.
const REVENUE_STATUSES: BookingStatus[] = ["PAID", "ACTIVE", "COMPLETED"];
// "Total bookings" = real bookings that made it past the inquiry/negotiation
// stage, whether or not they were later cancelled — CONFIRMED and everything
// downstream of it, including CANCELLED (which can happen after confirming).
const REAL_BOOKING_STATUSES: BookingStatus[] = ["CONFIRMED", "PAID", "ACTIVE", "COMPLETED", "CANCELLED"];

export async function getPlatformOverview() {
  const cacheKey = "platform:analytics:overview";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const now  = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalBookings,
    monthlyBookings,
    totalRevenue,
    monthlyRevenue,
    activeAgencies,
    tierBreakdown,
    revenueByAgency,
    bookingsByPackage,
    bookingsByCountry,
  ] = await Promise.all([
    prisma.booking.count({ where: { status: { in: REAL_BOOKING_STATUSES } } }),
    prisma.booking.count({ where: { status: { in: REAL_BOOKING_STATUSES }, createdAt: { gte: startOfMonth } } }),
    prisma.booking.aggregate({ _sum: { totalPrice: true }, where: { status: { in: REVENUE_STATUSES } } }),
    prisma.booking.aggregate({ _sum: { totalPrice: true }, where: { status: { in: REVENUE_STATUSES }, createdAt: { gte: startOfMonth } } }),
    prisma.agency.count({ where: { status: "ACTIVE" } }),
    tierCounts(),
    prisma.booking.groupBy({ by: ["agencyId"], _sum: { totalPrice: true }, where: { status: { in: REVENUE_STATUSES } } }),
    prisma.booking.groupBy({ by: ["packageId"], _count: { _all: true }, where: { status: { in: REAL_BOOKING_STATUSES } } }),
    prisma.booking.groupBy({
      by: ["trekkerCountry"],
      where: { status: { in: REAL_BOOKING_STATUSES } },
      _count: { _all: true },
      _sum: { totalPrice: true },
    }),
  ]);

  const revenueByTier = await sumByTier(
    revenueByAgency.map((r) => ({ agencyId: r.agencyId, value: Number(r._sum?.totalPrice ?? 0) })),
  );

  // Destinations live on the package, not the booking — resolve in one query,
  // same "collect ids, look up names" pattern as getAgencyPerformance below.
  const packageIds = bookingsByPackage.map((b) => b.packageId);
  const packages = await prisma.trekPackage.findMany({ where: { id: { in: packageIds } }, select: { id: true, destination: true } });
  const destinationOf = new Map(packages.map((p) => [p.id, p.destination]));
  const byDestination = new Map<string, number>();
  for (const b of bookingsByPackage) {
    const dest = destinationOf.get(b.packageId) ?? "Unknown";
    const count = (b._count as { _all: number } | undefined)?._all ?? 0;
    byDestination.set(dest, (byDestination.get(dest) ?? 0) + count);
  }
  const topDestinations = [...byDestination.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([destination, bookings]) => ({ destination, bookings }));

  // Real trekker-entered free text ("Nepal" / "nepal" / "" / null) — normalize
  // casing so the same country isn't split into two rows, and never guess a
  // country for a booking that didn't record one.
  const byCountry = new Map<string, { bookings: number; revenue: number }>();
  for (const row of bookingsByCountry) {
    const raw = row.trekkerCountry?.trim();
    const country = raw ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : "Unknown";
    const entry = byCountry.get(country) ?? { bookings: 0, revenue: 0 };
    entry.bookings += row._count?._all ?? 0;
    entry.revenue += Number(row._sum?.totalPrice ?? 0);
    byCountry.set(country, entry);
  }
  const customerDemographics = [...byCountry.entries()]
    .map(([country, v]) => ({ country, bookings: v.bookings, revenue: v.revenue }))
    .sort((a, b) => b.bookings - a.bookings);

  const result = {
    generatedAt:      now.toISOString(),
    totalBookings,
    monthlyBookings,
    totalRevenue:     Number(totalRevenue._sum?.totalPrice ?? 0),
    monthlyRevenue:   Number(monthlyRevenue._sum?.totalPrice ?? 0),
    activeAgencies,
    agenciesByTier:   tierBreakdown,
    revenueByTier:    revenueByTier.map((r) => ({ tier: r.tier, revenue: r.value })),
    topDestinations,
    customerDemographics,
  };

  await cacheSet(cacheKey, result, PLATFORM_CACHE_TTL);
  return result;
}

// ── Agency performance ────────────────────────────────────────────────────────

export async function getAgencyPerformance() {
  const cacheKey = "platform:analytics:agencies";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  // Real Booking data, not the Mongo event stream — see getPlatformOverview's
  // doc comment for why: the event stream only has activity from after
  // trackEvent got wired into the booking flow, so it silently hid every
  // agency's historical bookings/revenue/retention.
  const [byBookings, byRevenue, byTrekkerAgency] = await Promise.all([
    prisma.booking.groupBy({
      by: ["agencyId"],
      where: { status: { in: REAL_BOOKING_STATUSES } },
      _count: { _all: true },
      orderBy: { _count: { agencyId: "desc" } },
      take: 10,
    }),
    prisma.booking.groupBy({
      by: ["agencyId"],
      where: { status: { in: REVENUE_STATUSES } },
      _sum: { totalPrice: true },
      orderBy: { _sum: { totalPrice: "desc" } },
      take: 10,
    }),
    prisma.booking.groupBy({
      by: ["agencyId", "trekkerId"],
      where: { status: { in: REAL_BOOKING_STATUSES }, trekkerId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  // Retention: for each agency, what share of its distinct trekkers booked more than once.
  const byAgency = new Map<string, { total: number; returning: number }>();
  for (const row of byTrekkerAgency) {
    const entry = byAgency.get(row.agencyId) ?? { total: 0, returning: 0 };
    entry.total += 1;
    if ((row._count?._all ?? 0) > 1) entry.returning += 1;
    byAgency.set(row.agencyId, entry);
  }
  const topByRetention = [...byAgency.entries()]
    .filter(([, v]) => v.total > 0)
    .map(([agencyId, v]) => ({ agencyId, retentionRate: (v.returning / v.total) * 100, totalCustomers: v.total }))
    .sort((a, b) => b.retentionRate - a.retentionRate)
    .slice(0, 10);

  const topByBookings = byBookings.map((b) => ({ agencyId: b.agencyId, bookings: b._count?._all ?? 0 }));
  const topByRevenue = byRevenue.map((b) => ({ agencyId: b.agencyId, revenue: Number(b._sum?.totalPrice ?? 0) }));

  // A leaderboard of UUIDs is useless to the admin reading it — resolve names in one query.
  const ids = [...new Set([...topByBookings, ...topByRevenue, ...topByRetention].map((a) => a.agencyId))];
  const named = await prisma.agency.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(named.map((a) => [a.id, a.name]));

  const result = {
    generatedAt:    new Date().toISOString(),
    topByBookings:  topByBookings.map((a) => ({
      agency_id: a.agencyId,
      agency_name: nameOf.get(a.agencyId) ?? null,
      bookings:  a.bookings,
    })),
    topByRevenue:   topByRevenue.map((a) => ({
      agency_id: a.agencyId,
      agency_name: nameOf.get(a.agencyId) ?? null,
      revenue:   a.revenue,
    })),
    topByRetention: topByRetention.map((a) => ({
      agency_id:     a.agencyId,
      agency_name:   nameOf.get(a.agencyId) ?? null,
      retentionRate: Math.round(a.retentionRate * 10) / 10,
      totalCustomers: a.totalCustomers,
    })),
  };

  await cacheSet(cacheKey, result, PLATFORM_CACHE_TTL);
  return result;
}

// ── Marketplace analytics ─────────────────────────────────────────────────────

/**
 * Real booking status breakdown — not a Mongo-event funnel. A strict
 * "view → inquiry → confirmed → paid" funnel doesn't actually hold: every
 * booking starts life as INQUIRY (booking.service.ts), and CANCELLED is
 * reachable from almost any stage, not just the end, so forcing stage-to-stage
 * percentages onto it would look precise while quietly being wrong. A status
 * breakdown plus real, unambiguous rates (conversion/completion/cancellation)
 * says exactly what's true, and — unlike the PAGE_VIEW-dependent funnel it
 * replaces — needs no event tracking to work: every real booking already has
 * a status.
 */
async function getBookingStatusBreakdown() {
  const groups = await prisma.booking.groupBy({ by: ["status"], _count: { _all: true } });
  const byStatus: Record<string, number> = {};
  for (const g of groups) byStatus[g.status] = g._count?._all ?? 0;

  const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
  const paidOrBeyond = REVENUE_STATUSES.reduce((s, status) => s + (byStatus[status] ?? 0), 0);
  const completed = byStatus.COMPLETED ?? 0;
  const cancelled = byStatus.CANCELLED ?? 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  return {
    totalBookings: total,
    byStatus,
    conversionRate:   pct(paidOrBeyond), // reached PAID/CONFIRMED/ACTIVE/COMPLETED
    completionRate:   pct(completed),
    cancellationRate: pct(cancelled),
  };
}

export async function getMarketplaceAnalytics() {
  const cacheKey = "platform:analytics:marketplace";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const col = await getAnalyticsCollection();

  const [topDestinations, popularFilters, bookingStatusBreakdown] = await Promise.all([
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
    getBookingStatusBreakdown(),
  ]);

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
    bookingStatusBreakdown,
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

  // NOTE(phase-2): "recent upgrade / churn" uses createdAt as a proxy — Agency
  // has no updatedAt column yet. Refine when the admin dashboard is built.
  const [tierStatusGroups, names, recentUpgrades, recentChurned] = await Promise.all([
    prisma.agency.groupBy({ by: ["tierId", "status"], _count: { _all: true } }),
    tierNames(),
    prisma.agency.findMany({
      where: {
        tier:      { name: { not: "FREE" } },
        createdAt: { gte: thirtyDaysAgo },
        status:    "ACTIVE",
      },
      select: { id: true, tier: { select: { name: true } }, createdAt: true },
    }),
    prisma.agency.findMany({
      where: {
        status:    { in: ["SUSPENDED", "LOCKED"] },
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { id: true, tier: { select: { name: true } }, status: true },
    }),
  ]);

  // Build tier summary — seeded with every configured tier (not just ones with
  // at least one agency) so a newly-created paid tier with zero agencies still
  // shows up as "0 active", instead of silently vanishing from the report.
  const tierMap: Record<string, { active: number; suspended: number; locked: number }> = {};
  for (const name of names.values()) {
    tierMap[name] = { active: 0, suspended: 0, locked: 0 };
  }
  for (const g of tierStatusGroups) {
    const name = names.get(g.tierId) ?? "UNKNOWN";
    if (!tierMap[name]) tierMap[name] = { active: 0, suspended: 0, locked: 0 };
    const n = g._count._all;
    if (g.status === "ACTIVE")    tierMap[name].active    += n;
    if (g.status === "SUSPENDED") tierMap[name].suspended += n;
    if (g.status === "LOCKED")    tierMap[name].locked    += n;
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
      const name = a.tier?.name ?? "UNKNOWN";
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };

  await cacheSet(cacheKey, result, PLATFORM_CACHE_TTL);
  return result;
}
