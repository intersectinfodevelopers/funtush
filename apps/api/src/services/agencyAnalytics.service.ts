import { getAnalyticsCollection } from "../models/analyticsEvent.model";
import { db } from "@funtush/database";

// ── Period helpers ─────────────────────────────────────────────────────────────

export type Period = "last_7_days" | "last_30_days" | "last_12_months" | "custom";

export interface DateRange {
  from: Date;
  to:   Date;
}

export function resolveDateRange(
  period: Period,
  customFrom?: string,
  customTo?:   string
): DateRange {
  const now = new Date();
  const to  = new Date(now);
  to.setHours(23, 59, 59, 999);

  if (period === "last_7_days") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }
  if (period === "last_30_days") {
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }
  if (period === "last_12_months") {
    const from = new Date(now);
    from.setMonth(from.getMonth() - 11);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }
  // custom
  if (!customFrom || !customTo) throw new Error("custom period requires from and to dates");
  return {
    from: new Date(`${customFrom}T00:00:00.000Z`),
    to:   new Date(`${customTo}T23:59:59.999Z`),
  };
}

function dateLabel(date: Date, period: Period): string {
  if (period === "last_12_months") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return date.toISOString().split("T")[0];
}

// ── Overview analytics ─────────────────────────────────────────────────────────

export async function getOverviewAnalytics(agency_id: string, range: DateRange, period: Period) {
  const col = await getAnalyticsCollection();
  const filter = { agency_id, timestamp: { $gte: range.from, $lte: range.to } };

  const [bookingEvents, paidEvents, inquiryEvents] = await Promise.all([
    col.find({ ...filter, event_type: { $in: ["BOOKING_CONFIRMED", "BOOKING_PAID", "BOOKING_CANCELLED"] } })
       .sort({ timestamp: 1 }).toArray(),
    col.find({ ...filter, event_type: "BOOKING_PAID" }).toArray(),
    col.find({ ...filter, event_type: "INQUIRY_SUBMITTED" }).toArray(),
  ]);

  // Build daily/monthly buckets
  const bookingsByDay:   Record<string, number> = {};
  const revenueByDay:    Record<string, number> = {};
  const inquiriesByDay:  Record<string, number> = {};

  for (const e of bookingEvents) {
    // Matches totalBookings below (CONFIRMED only) — the chart used to also
    // fold in PAID and CANCELLED, so it never agreed with the headline stat
    // shown right above it.
    if (e.event_type !== "BOOKING_CONFIRMED") continue;
    const label = dateLabel(new Date(e.timestamp), period);
    bookingsByDay[label] = (bookingsByDay[label] ?? 0) + 1;
  }
  for (const e of paidEvents) {
    const label  = dateLabel(new Date(e.timestamp), period);
    const amount = typeof e.metadata.amount === "number" ? e.metadata.amount : 0;
    revenueByDay[label] = (revenueByDay[label] ?? 0) + amount;
  }
  for (const e of inquiryEvents) {
    const label = dateLabel(new Date(e.timestamp), period);
    inquiriesByDay[label] = (inquiriesByDay[label] ?? 0) + 1;
  }

  const totalBookings  = bookingEvents.filter((e: { event_type: string }) => e.event_type === "BOOKING_CONFIRMED").length;
  const totalInquiries = inquiryEvents.length;
  const totalRevenue = paidEvents.reduce((sum: number, e: { metadata: Record<string, unknown> }) => {
    return sum + (typeof e.metadata.amount === "number" ? e.metadata.amount : 0);
  }, 0);
  const conversionRate = totalInquiries > 0
    ? Math.round((totalBookings / totalInquiries) * 100 * 10) / 10
    : 0;

  // Per-bucket conversion rate, same formula as the aggregate above, so the
  // "Conversion rate" card can show a real trend line instead of a flat one.
  const conversionByDay = [...new Set([...Object.keys(bookingsByDay), ...Object.keys(inquiriesByDay)])]
    .sort()
    .map((date) => {
      const inquiries = inquiriesByDay[date] ?? 0;
      const bookings  = bookingsByDay[date] ?? 0;
      return { date, rate: inquiries > 0 ? Math.round((bookings / inquiries) * 100 * 10) / 10 : 0 };
    });

  return {
    period,
    dateRange:      { from: range.from.toISOString(), to: range.to.toISOString() },
    summary: {
      totalBookings,
      totalInquiries,
      totalRevenue,
      conversionRate,
    },
    charts: {
      bookingsByDay: Object.entries(bookingsByDay).map(([date, count]) => ({ date, count })),
      revenueByDay:  Object.entries(revenueByDay).map(([date, revenue]) => ({ date, revenue })),
      conversionByDay,
    },
  };
}

// Package analytics

export async function getPackageAnalytics(agency_id: string, range: DateRange) {
  const col    = await getAnalyticsCollection();
  const filter = { agency_id, timestamp: { $gte: range.from, $lte: range.to } };

  const events = await col
    .find({ ...filter, event_type: { $in: ["BOOKING_CONFIRMED", "BOOKING_PAID"] } })
    .toArray();

  const packageMap: Record<string, { bookings: number; revenue: number; package_id: string }> = {};

  for (const e of events) {
    const pid = e.package_id ?? "unknown";
    if (!packageMap[pid]) packageMap[pid] = { bookings: 0, revenue: 0, package_id: pid };
    if (e.event_type === "BOOKING_CONFIRMED") packageMap[pid].bookings++;
    if (e.event_type === "BOOKING_PAID") {
      packageMap[pid].revenue += typeof e.metadata.amount === "number" ? e.metadata.amount : 0;
    }
  }

  const all = Object.values(packageMap);
  const packages = [...all].sort((a, b) => b.bookings - a.bookings).slice(0, 10);

  return {
    topByBookings: [...packages].sort((a, b) => b.bookings - a.bookings),
    topByRevenue:  [...packages].sort((a, b) => b.revenue - a.revenue),
    // Count of every distinct package with activity in the period — NOT the
    // top-10 slice above (that undercounted an agency with >10 active packages).
    total:         all.length,
  };
}

// ── Customer analytics 

export async function getCustomerAnalytics(agency_id: string, range: DateRange) {
  const col    = await getAnalyticsCollection();
  const filter = { agency_id, timestamp: { $gte: range.from, $lte: range.to } };

  const events = await col
    .find({ ...filter, event_type: { $in: ["BOOKING_CONFIRMED", "BOOKING_PAID"] } })
    .toArray();

  // Count bookings per trekker
  const trekkerMap: Record<string, { bookings: number; revenue: number; trekker_id: string }> = {};
  for (const e of events) {
    const tid = e.trekker_id ?? "anonymous";
    if (!trekkerMap[tid]) trekkerMap[tid] = { bookings: 0, revenue: 0, trekker_id: tid };
    if (e.event_type === "BOOKING_CONFIRMED") trekkerMap[tid].bookings++;
    if (e.event_type === "BOOKING_PAID") {
      trekkerMap[tid].revenue += typeof e.metadata.amount === "number" ? e.metadata.amount : 0;
    }
  }

  const allTrekkers  = Object.values(trekkerMap);
  const newCustomers = allTrekkers.filter((t) => t.bookings === 1).length;
  const returning    = allTrekkers.filter((t) => t.bookings > 1).length;

  // Geographic sources from metadata
  const geoMap: Record<string, number> = {};
  for (const e of events) {
    const country = typeof e.metadata.country === "string" ? e.metadata.country : "Unknown";
    geoMap[country] = (geoMap[country] ?? 0) + 1;
  }
  const geographicSources = Object.entries(geoMap)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topCustomers = allTrekkers
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, 10);

  return {
    summary: {
      totalCustomers:  allTrekkers.length,
      newCustomers,
      returningCustomers: returning,
      retentionRate: allTrekkers.length > 0
        ? Math.round((returning / allTrekkers.length) * 100 * 10) / 10
        : 0,
    },
    topCustomers,
    geographicSources,
  };
}

// guid e analyis

export async function getGuideAnalytics(agency_id: string, range: DateRange) {
  const col    = await getAnalyticsCollection();
  const filter = { agency_id, timestamp: { $gte: range.from, $lte: range.to } };

  const events = await col
    .find({ ...filter, event_type: "BOOKING_CONFIRMED" })
    .toArray();

  const guideMap: Record<string, { bookings: number; guide_id: string }> = {};
  for (const e of events) {
    const gid = typeof e.metadata.guide_id === "string" ? e.metadata.guide_id : null;
    if (!gid) continue;
    if (!guideMap[gid]) guideMap[gid] = { bookings: 0, guide_id: gid };
    guideMap[gid].bookings++;
  }

  const guides       = Object.values(guideMap).sort((a, b) => b.bookings - a.bookings);
  const totalGuides  = guides.length;
  const totalBooked  = guides.reduce((s, g) => s + g.bookings, 0);
  const avgPerGuide  = totalGuides > 0
    ? Math.round((totalBooked / totalGuides) * 10) / 10
    : 0;

  return {
    summary: {
      totalGuides,
      totalBookingsWithGuide: totalBooked,
      avgBookingsPerGuide:    avgPerGuide,
      utilizationRate:        events.length > 0
        ? Math.round((totalBooked / events.length) * 100 * 10) / 10
        : 0,
    },
    guides,
  };
}

// ── Trekker origin × package performance ─────────────────────────────────────
//
// The Mongo analytics events above never carry a trekker's country (the
// booking-status middleware that writes them doesn't set metadata.country),
// so geographicSources in getCustomerAnalytics is always "Unknown" in real
// use. Booking.trekkerCountry is a real, populated column — this reads from
// Postgres bookings instead, which is also where "confirmed" actually lives.

const round2 = (n: number) => Math.round(n * 100) / 100;

// Statuses that represent a real, committed booking — not an inquiry, a
// pending payment, or something that fell through.
const COUNTED_BOOKING_STATUSES = ["CONFIRMED", "PAID", "ACTIVE", "COMPLETED"] as const;

export interface OriginPackageRow {
  country: string;
  packageId: string;
  packageTitle: string | null;
  bookings: number;
  revenueNet: number;
  avgValue: number;
  lastBooking: string;
}

export async function getOriginPackagePerformance(agencyId: string, range: DateRange): Promise<OriginPackageRow[]> {
  const rows = await db.booking.findMany({
    where: {
      agencyId,
      status: { in: [...COUNTED_BOOKING_STATUSES] },
      createdAt: { gte: range.from, lte: range.to },
    },
    select: { trekkerCountry: true, packageId: true, totalPrice: true, createdAt: true, package: { select: { title: true } } },
  });

  const byKey = new Map<string, { country: string; packageId: string; packageTitle: string | null; bookings: number; revenue: number; last: Date }>();
  for (const b of rows) {
    const country = b.trekkerCountry?.trim() || "Unknown";
    const key = `${country}::${b.packageId}`;
    const amount = Number(b.totalPrice);
    const existing = byKey.get(key);
    if (existing) {
      existing.bookings += 1;
      existing.revenue += amount;
      if (b.createdAt > existing.last) existing.last = b.createdAt;
    } else {
      byKey.set(key, { country, packageId: b.packageId, packageTitle: b.package?.title ?? null, bookings: 1, revenue: amount, last: b.createdAt });
    }
  }

  return [...byKey.values()]
    .map((r) => ({
      country: r.country,
      packageId: r.packageId,
      packageTitle: r.packageTitle,
      bookings: r.bookings,
      revenueNet: round2(r.revenue),
      avgValue: round2(r.revenue / r.bookings),
      lastBooking: r.last.toISOString(),
    }))
    .sort((a, b) => b.bookings - a.bookings);
}
