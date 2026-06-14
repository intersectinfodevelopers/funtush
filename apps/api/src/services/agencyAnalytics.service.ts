import { getAnalyticsCollection } from "../models/analyticsEvent.model";

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
  const bookingsByDay: Record<string, number> = {};
  const revenueByDay:  Record<string, number> = {};

  for (const e of bookingEvents) {
    const label = dateLabel(new Date(e.timestamp), period);
    bookingsByDay[label] = (bookingsByDay[label] ?? 0) + 1;
  }
  for (const e of paidEvents) {
    const label  = dateLabel(new Date(e.timestamp), period);
    const amount = typeof e.metadata.amount === "number" ? e.metadata.amount : 0;
    revenueByDay[label] = (revenueByDay[label] ?? 0) + amount;
  }

const totalBookings  = bookingEvents.filter((e: { event_type: string }) => e.event_type === "BOOKING_CONFIRMED").length;
  const totalInquiries = inquiryEvents.length;
 const totalRevenue = paidEvents.reduce((sum: number, e: { metadata: Record<string, unknown> }) => {
    return sum + (typeof e.metadata.amount === "number" ? e.metadata.amount : 0);
  }, 0);
  const conversionRate = totalInquiries > 0
    ? Math.round((totalBookings / totalInquiries) * 100 * 10) / 10
    : 0;

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
    },
  };
}

// ── Package analytics ──────────────────────────────────────────────────────────

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

  const packages = Object.values(packageMap)
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, 10);

  return {
    topByBookings: [...packages].sort((a, b) => b.bookings - a.bookings),
    topByRevenue:  [...packages].sort((a, b) => b.revenue - a.revenue),
    total:         packages.length,
  };
}

// ── Customer analytics ─────────────────────────────────────────────────────────

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

// ── Guide analytics ────────────────────────────────────────────────────────────

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
