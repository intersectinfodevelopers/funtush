import { getAnalyticsCollection } from "../models/analyticsEvent.model";
import type { DateRange } from "./agencyAnalytics.service";

// ── Report data shapes ─────────────────────────────────────────────────────────

export interface ReportData {
  agencyId:     string;
  periodLabel:  string;       // "March 2024" or "2024"
  generatedAt:  string;
  summary: {
    totalBookings:  number;
    totalRevenue:   number;
    totalInquiries: number;
    cancelled:      number;
    conversionRate: number;
  };
  topPackages: Array<{ package_id: string; bookings: number; revenue: number }>;
  guides:      Array<{ guide_id: string; bookings: number }>;
  bookingsByDay: Array<{ date: string; count: number }>;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

export function monthRange(month: string): DateRange {
  // month = "2024-03"
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error("Invalid month format, expected YYYY-MM");
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const to   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)); // last day of month
  return { from, to };
}

export function yearRange(year: string): DateRange {
  const y = Number(year);
  if (!y || y < 2000 || y > 3000) throw new Error("Invalid year format, expected YYYY");
  const from = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
  const to   = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
  return { from, to };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// ── Build report data ───────────────────────────────────────────────────────────

export async function buildReportData(
  agencyId:    string,
  range:       DateRange,
  periodLabel: string
): Promise<ReportData> {
  const col    = await getAnalyticsCollection();
  const filter = { agency_id: agencyId, timestamp: { $gte: range.from, $lte: range.to } };

  const [confirmedEvents, paidEvents, inquiryEvents, cancelledEvents] = await Promise.all([
    col.find({ ...filter, event_type: "BOOKING_CONFIRMED" }).toArray(),
    col.find({ ...filter, event_type: "BOOKING_PAID" }).toArray(),
    col.find({ ...filter, event_type: "INQUIRY_SUBMITTED" }).toArray(),
    col.find({ ...filter, event_type: "BOOKING_CANCELLED" }).toArray(),
  ]);

  const totalBookings  = confirmedEvents.length;
  const totalInquiries = inquiryEvents.length;
  const cancelled      = cancelledEvents.length;
  const totalRevenue   = paidEvents.reduce(
    (sum: number, e: { metadata: Record<string, unknown> }) =>
      sum + (typeof e.metadata.amount === "number" ? e.metadata.amount : 0),
    0
  );
  const conversionRate = totalInquiries > 0
    ? Math.round((totalBookings / totalInquiries) * 100 * 10) / 10
    : 0;

  // Top packages
  const pkgMap: Record<string, { package_id: string; bookings: number; revenue: number }> = {};
  for (const e of confirmedEvents) {
    const pid = e.package_id ?? "unknown";
    if (!pkgMap[pid]) pkgMap[pid] = { package_id: pid, bookings: 0, revenue: 0 };
    pkgMap[pid].bookings++;
  }
  for (const e of paidEvents) {
    const pid = e.package_id ?? "unknown";
    if (!pkgMap[pid]) pkgMap[pid] = { package_id: pid, bookings: 0, revenue: 0 };
    pkgMap[pid].revenue += typeof e.metadata.amount === "number" ? e.metadata.amount : 0;
  }
  const topPackages = Object.values(pkgMap)
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, 10);

  // Guides
  const guideMap: Record<string, { guide_id: string; bookings: number }> = {};
  for (const e of confirmedEvents) {
    const gid = typeof e.metadata.guide_id === "string" ? e.metadata.guide_id : null;
    if (!gid) continue;
    if (!guideMap[gid]) guideMap[gid] = { guide_id: gid, bookings: 0 };
    guideMap[gid].bookings++;
  }
  const guides = Object.values(guideMap).sort((a, b) => b.bookings - a.bookings);

  // Bookings by day
  const byDay: Record<string, number> = {};
  for (const e of confirmedEvents) {
    const label = new Date(e.timestamp).toISOString().split("T")[0];
    byDay[label] = (byDay[label] ?? 0) + 1;
  }
  const bookingsByDay = Object.entries(byDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    agencyId,
    periodLabel,
    generatedAt: new Date().toISOString(),
    summary: { totalBookings, totalRevenue, totalInquiries, cancelled, conversionRate },
    topPackages,
    guides,
    bookingsByDay,
  };
}

// ── CSV export ───────────────────────────────────────────────────────────────

export function toCSV(data: ReportData): string {
  const lines: string[] = [];
  lines.push(`Funtush Report,${data.periodLabel}`);
  lines.push(`Agency,${data.agencyId}`);
  lines.push(`Generated,${data.generatedAt}`);
  lines.push("");

  lines.push("SUMMARY");
  lines.push("Metric,Value");
  lines.push(`Total Bookings,${data.summary.totalBookings}`);
  lines.push(`Total Revenue,${data.summary.totalRevenue}`);
  lines.push(`Total Inquiries,${data.summary.totalInquiries}`);
  lines.push(`Cancelled,${data.summary.cancelled}`);
  lines.push(`Conversion Rate,${data.summary.conversionRate}%`);
  lines.push("");

  lines.push("TOP PACKAGES");
  lines.push("Package,Bookings,Revenue");
  for (const p of data.topPackages) {
    lines.push(`${p.package_id},${p.bookings},${p.revenue}`);
  }
  lines.push("");

  lines.push("GUIDES");
  lines.push("Guide,Bookings");
  for (const g of data.guides) {
    lines.push(`${g.guide_id},${g.bookings}`);
  }
  lines.push("");

  lines.push("BOOKINGS BY DAY");
  lines.push("Date,Bookings");
  for (const d of data.bookingsByDay) {
    lines.push(`${d.date},${d.count}`);
  }

  return lines.join("\n");
}

// ── HTML (for PDF rendering via puppeteer) ──────────────────────────────────────

export function toHTML(data: ReportData): string {
  const pkgRows = data.topPackages
    .map((p) => `<tr><td>${p.package_id}</td><td>${p.bookings}</td><td>${p.revenue}</td></tr>`)
    .join("");
  const guideRows = data.guides
    .map((g) => `<tr><td>${g.guide_id}</td><td>${g.bookings}</td></tr>`)
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, sans-serif; color: #1a1a1a; padding: 40px; }
  h1 { color: #0d7a5f; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .cards { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
  .card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; min-width: 140px; }
  .card .label { font-size: 11px; color: #888; text-transform: uppercase; }
  .card .value { font-size: 24px; font-weight: bold; color: #0d7a5f; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
  th { background: #f5f5f5; }
  h2 { font-size: 16px; margin-top: 24px; }
</style>
</head>
<body>
  <h1>Funtush Report</h1>
  <div class="meta">${data.periodLabel} &middot; Agency ${data.agencyId} &middot; Generated ${data.generatedAt}</div>

  <div class="cards">
    <div class="card"><div class="label">Bookings</div><div class="value">${data.summary.totalBookings}</div></div>
    <div class="card"><div class="label">Revenue</div><div class="value">${data.summary.totalRevenue}</div></div>
    <div class="card"><div class="label">Inquiries</div><div class="value">${data.summary.totalInquiries}</div></div>
    <div class="card"><div class="label">Cancelled</div><div class="value">${data.summary.cancelled}</div></div>
    <div class="card"><div class="label">Conversion</div><div class="value">${data.summary.conversionRate}%</div></div>
  </div>

  <h2>Top Packages</h2>
  <table><thead><tr><th>Package</th><th>Bookings</th><th>Revenue</th></tr></thead>
  <tbody>${pkgRows || "<tr><td colspan='3'>No data</td></tr>"}</tbody></table>

  <h2>Guides</h2>
  <table><thead><tr><th>Guide</th><th>Bookings</th></tr></thead>
  <tbody>${guideRows || "<tr><td colspan='2'>No data</td></tr>"}</tbody></table>
</body>
</html>`;
}

// ── PDF generation (puppeteer, lazy-loaded so tests don't need it) ──────────────

export async function toPDF(data: ReportData): Promise<Buffer> {
  const html = toHTML(data);
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
