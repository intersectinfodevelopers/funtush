import { db, Prisma } from "@funtush/database";
import { fieldError, httpError } from "../utils/httpError";

/**
 * Customers who completed a trek WITHOUT a Funtush account ("guests") are still customers, and the agency can
 * edit or delete any customer from ITS list. None of this touches the trekker's account or any booking:
 *  - a guest is identified by `guest:<lowercased email>` (their completed, unlinked bookings);
 *  - "edit" stores the agency's own name / phone / country for that customer (AgencyCustomerOverride);
 *  - "delete" hides the customer from the list (until they book again after that moment).
 */
export const GUEST_PREFIX = "guest:";
export const isGuestKey = (key: string) => key.startsWith(GUEST_PREFIX);
export const guestKey = (email: string) => `${GUEST_PREFIX}${email.trim().toLowerCase()}`;
const guestEmail = (key: string) => key.slice(GUEST_PREFIX.length);

export interface CustomerListRow {
  trekkerId: string; // the customer key (trekker id, or guest:<email>)
  fullName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  totalBookings: number;
  totalSpending: number;
  lastBookingDate: Date;
  repeatVisitor: boolean;
  isNewCustomer: boolean;
  isGuest: boolean;
}

export async function hasGuestCustomers(agencyId: string): Promise<boolean> {
  const r = await db.$queryRaw<{ x: number }[]>(Prisma.sql`
    SELECT 1 AS x FROM bookings WHERE agency_id = ${agencyId} AND trekker_id IS NULL AND status = 'COMPLETED' LIMIT 1`);
  return r.length > 0;
}

/** Customer keys currently hidden ("deleted") — a customer who booked again after being hidden is visible again. */
export async function hiddenCustomerKeys(agencyId: string): Promise<Set<string>> {
  const over = await db.agencyCustomerOverride.findMany({ where: { agencyId, hiddenAt: { not: null } }, select: { customerKey: true, hiddenAt: true } });
  if (over.length === 0) return new Set();
  const hidden = new Set<string>();
  const linked = over.filter((o) => !isGuestKey(o.customerKey));
  const guests = over.filter((o) => isGuestKey(o.customerKey));
  if (linked.length) {
    const stats = await db.agencyCustomerStat.findMany({ where: { agencyId, trekkerId: { in: linked.map((o) => o.customerKey) } }, select: { trekkerId: true, lastBookingAt: true } });
    const last = new Map(stats.map((s) => [s.trekkerId, s.lastBookingAt]));
    for (const o of linked) if (!last.has(o.customerKey) || last.get(o.customerKey)! <= o.hiddenAt!) hidden.add(o.customerKey);
  }
  for (const o of guests) {
    const b = await db.booking.findFirst({ where: { agencyId, trekkerId: null, status: "COMPLETED", trekkerEmail: { equals: guestEmail(o.customerKey), mode: "insensitive" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!b || b.createdAt <= o.hiddenAt!) hidden.add(o.customerKey);
  }
  return hidden;
}

export async function applyOverrides<T extends { trekkerId: string; fullName: string | null; email: string | null; phone: string | null; country: string | null }>(agencyId: string, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const over = await db.agencyCustomerOverride.findMany({ where: { agencyId, customerKey: { in: rows.map((r) => r.trekkerId) } } });
  const by = new Map(over.map((o) => [o.customerKey, o]));
  return rows.map((r) => {
    const o = by.get(r.trekkerId);
    return o ? { ...r, fullName: o.fullName ?? r.fullName, email: o.email ?? r.email, phone: o.phone ?? r.phone, country: o.country ?? r.country } : r;
  });
}

/** The list when the agency has guest customers: linked + guest rows in one query (so paging / sorting stay right). */
export async function unifiedCustomerList(
  agencyId: string,
  q: { page: number; limit: number; search?: string; customerType?: "repeat" | "new"; sortBy: string; sortOrder: string },
) {
  const hidden = [...(await hiddenCustomerKeys(agencyId))];
  const search = q.search?.trim();
  const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const dir = q.sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const sortCol = q.sortBy === "totalBookings" ? Prisma.sql`total_bookings` : q.sortBy === "totalSpending" ? Prisma.sql`total_spent` : Prisma.sql`last_booking_at`;
  const filters = [
    hidden.length ? Prisma.sql`key NOT IN (${Prisma.join(hidden)})` : Prisma.empty,
    q.customerType === "repeat" ? Prisma.sql`AND total_bookings > 1` : q.customerType === "new" ? Prisma.sql`AND total_bookings = 1` : Prisma.empty,
    pattern ? Prisma.sql`AND (full_name ILIKE ${pattern} OR phone ILIKE ${pattern} OR email ILIKE ${pattern})` : Prisma.empty,
  ];
  const where = hidden.length ? Prisma.sql`WHERE ${filters[0]} ${filters[1]} ${filters[2]}` : Prisma.sql`WHERE TRUE ${filters[1]} ${filters[2]}`;

  const base = Prisma.sql`
    WITH linked AS (
      SELECT s.trekker_id AS key, coalesce(o.full_name, t."fullName") AS full_name, coalesce(o.phone, t.phone) AS phone,
             coalesce(o.country, t.country) AS country, coalesce(o.email, u.email) AS email, s.total_bookings, s.total_spent, s.last_booking_at, false AS is_guest
        FROM agency_customer_stats s
        JOIN trekker t ON t.id = s.trekker_id
        JOIN users u ON u.id = t.user_id
        LEFT JOIN agency_customer_overrides o ON o.agency_id = s.agency_id AND o.customer_key = s.trekker_id
       WHERE s.agency_id = ${agencyId}
    ), guests AS (
      SELECT 'guest:' || lower(b.trekker_email) AS key,
             coalesce(o.full_name, (array_agg(b.trekker_name ORDER BY b.created_at DESC))[1]) AS full_name,
             coalesce(o.phone, (array_agg(b.trekker_phone ORDER BY b.created_at DESC))[1]) AS phone,
             coalesce(o.country, (array_agg(b.trekker_country ORDER BY b.created_at DESC))[1]) AS country,
             coalesce(o.email, lower(b.trekker_email)) AS email, count(*)::int AS total_bookings, sum(b.total_price) AS total_spent,
             max(b.created_at) AS last_booking_at, true AS is_guest
        FROM bookings b
        LEFT JOIN agency_customer_overrides o ON o.agency_id = b.agency_id AND o.customer_key = 'guest:' || lower(b.trekker_email)
       WHERE b.agency_id = ${agencyId} AND b.trekker_id IS NULL AND b.status = 'COMPLETED'
       GROUP BY lower(b.trekker_email), o.full_name, o.phone, o.country, o.email
    ), everyone AS (SELECT * FROM linked UNION ALL SELECT * FROM guests)`;

  type Row = { key: string; full_name: string | null; phone: string | null; country: string | null; email: string | null; total_bookings: number; total_spent: Prisma.Decimal; last_booking_at: Date; is_guest: boolean };
  const [rows, countRows] = await Promise.all([
    db.$queryRaw<Row[]>(Prisma.sql`${base} SELECT * FROM everyone ${where} ORDER BY ${sortCol} ${dir}, key ASC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`),
    db.$queryRaw<{ n: bigint }[]>(Prisma.sql`${base} SELECT count(*) AS n FROM everyone ${where}`),
  ]);
  const total = Number(countRows[0]?.n ?? 0);
  return {
    data: rows.map<CustomerListRow>((r) => ({
      trekkerId: r.key,
      fullName: r.full_name,
      email: r.email,
      phone: r.phone,
      country: r.country,
      totalBookings: Number(r.total_bookings),
      totalSpending: Number(r.total_spent),
      lastBookingDate: r.last_booking_at,
      repeatVisitor: Number(r.total_bookings) > 1,
      isNewCustomer: Number(r.total_bookings) === 1,
      isGuest: r.is_guest,
    })),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  };
}

/** Profile of a guest customer, in the same shape as a trekker's. Null when this agency has no such guest. */
export async function guestProfile(customerKey: string, agencyId: string) {
  const email = guestEmail(customerKey);
  const bookings = await db.booking.findMany({
    where: { agencyId, trekkerId: null, trekkerEmail: { equals: email, mode: "insensitive" } },
    include: { package: { select: { id: true, title: true, destinations: { select: { name: true } } } }, paymentLink: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!bookings.some((b) => b.status === "COMPLETED")) return null;
  const over = await db.agencyCustomerOverride.findUnique({ where: { agencyId_customerKey: { agencyId, customerKey } } });
  const latest = bookings[0];
  const totalSpent = bookings.reduce((s, b) => s + Number(b.totalPrice || 0), 0);
  return {
    success: true,
    message: "Customer profile fetched successfully",
    data: {
      customer: {
        id: customerKey,
        fullName: over?.fullName ?? latest.trekkerName,
        phone: over?.phone ?? latest.trekkerPhone,
        country: over?.country ?? latest.trekkerCountry,
        nationality: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        isEmailVerified: false,
        createdAt: bookings[bookings.length - 1].createdAt,
        user: { email: over?.email ?? email },
        isGuest: true,
      },
      stats: {
        totalSpent,
        visitCount: bookings.length,
        firstBookingDate: bookings[bookings.length - 1].createdAt,
        lastBookingDate: latest.createdAt,
        averageBookingValue: bookings.length ? totalSpent / bookings.length : 0,
        preferredDestinations: [],
        badge: bookings.length >= 3 ? "Loyal Customer" : null,
      },
      bookingHistory: bookings,
      notes: [],
    },
  };
}

async function assertCustomerOfAgency(agencyId: string, key: string) {
  const ok = isGuestKey(key)
    ? await db.booking.findFirst({ where: { agencyId, trekkerId: null, status: "COMPLETED", trekkerEmail: { equals: guestEmail(key), mode: "insensitive" } }, select: { id: true } })
    : await db.booking.findFirst({ where: { agencyId, trekkerId: key }, select: { id: true } });
  if (!ok) throw httpError(404, "Customer not found");
}

const clean = (v: unknown, field: string, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw fieldError(field, "Enter text.");
  const t = v.trim();
  if (t.length > max) throw fieldError(field, `Must be at most ${max} characters.`);
  return t === "" ? null : t;
};

/** Edit how THIS agency sees the customer. An empty value clears the agency's edit (the original shows again). */
export async function updateCustomerRecord(agencyId: string, key: string, body: { fullName?: unknown; email?: unknown; phone?: unknown; country?: unknown }) {
  const fullName = clean(body.fullName, "fullName", 120);
  const email = clean(body.email, "email", 254);
  const phone = clean(body.phone, "phone", 40);
  const country = clean(body.country, "country", 80);
  if (fullName === undefined && email === undefined && phone === undefined && country === undefined) throw httpError(400, "Nothing to update");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw fieldError("email", "Enter a valid email address.");
  if (phone && !/^[+()\d\s-]{6,40}$/.test(phone)) throw fieldError("phone", "Enter a valid phone number.");
  await assertCustomerOfAgency(agencyId, key);
  const data = { ...(fullName !== undefined ? { fullName } : {}), ...(email !== undefined ? { email: email ? email.toLowerCase() : null } : {}), ...(phone !== undefined ? { phone } : {}), ...(country !== undefined ? { country } : {}) };
  await db.agencyCustomerOverride.upsert({
    where: { agencyId_customerKey: { agencyId, customerKey: key } },
    create: { agencyId, customerKey: key, ...data },
    update: data,
  });
  return { success: true, message: "Customer updated" };
}

/** Remove the customer from THIS agency's list. Bookings and the trekker's account are untouched. */
export async function hideCustomer(agencyId: string, key: string) {
  await assertCustomerOfAgency(agencyId, key);
  await db.agencyCustomerOverride.upsert({
    where: { agencyId_customerKey: { agencyId, customerKey: key } },
    create: { agencyId, customerKey: key, hiddenAt: new Date() },
    update: { hiddenAt: new Date() },
  });
  return { success: true, message: "Customer removed from your list" };
}
