import { db } from "@funtush/database";
import type { BookingStatus } from "@funtush/database";
import { buildMeta, type PageRequest, type PageMeta } from "../utils/pagination";

/**
 * ── Mobile-optimized API layer (Mobile week · Day 1) ─────────────────────────
 *
 * The React Native app (trekkers + guides share one binary, the UI switches on
 * role at login) talks to the same backend as the web dashboard. But a phone in
 * the Khumbu is not a laptop on office Wi-Fi, so these endpoints follow three
 * rules that the web endpoints do not:
 *
 *   1. **Slim payloads.** Only the fields a dashboard *screen* actually renders.
 *      No itinerary arrays, no add-on lists, no agency profile blobs. Details
 *      are fetched on demand when the user taps through to a booking.
 *   2. **Flat shapes.** Values are plain strings and numbers, never nested
 *      objects. `packageTitle: "Everest Base Camp"` instead of
 *      `package: { title: ..., slug: ..., agency: { ... } }`. Flat JSON is
 *      smaller on the wire and trivially maps to a mobile view-model.
 *   3. **Pagination everywhere.** Every list is paginated, with a small default
 *      page size (10) so the first screen paints fast on a slow link.
 *
 * Tenant isolation (Backend Guide §4 and §7)
 * ──────────────────────────────────────────
 * A trekker's identity is platform-level, so the *trekker* dashboard is scoped
 * by `trekkerId` and deliberately spans every agency the trekker has booked
 * with — that is the trekker's own data, not another tenant's.
 * The *guide* dashboard is the opposite: it is scoped by `agencyId` taken from
 * the JWT **and** by the guide's own identity, so a guide can only ever see
 * treks assigned to them inside their own agency.
 */

/* ── Section model ───────────────────────────────────────────────────────── */

/** The three buckets a dashboard splits treks into. */
export type TrekSection = "upcoming" | "active" | "completed";

export const TREK_SECTIONS: readonly TrekSection[] = ["upcoming", "active", "completed"];

/**
 * Which `BookingStatus` values belong to each section.
 *
 * - **upcoming** — anything still "in flight" before departure day. The item's
 *   own `status` field lets the app label it ("Awaiting confirmation",
 *   "Payment pending", "Confirmed"), so one list covers the whole pre-trek
 *   funnel without three near-identical screens.
 * - **active** — the trek is running right now.
 * - **completed** — the trek finished (this is also the state that unlocks
 *   reviews, per Backend Guide §8).
 *
 * `CANCELLED` and `REJECTED` are in no section on purpose: they are dead
 * bookings and showing them on a dashboard is noise.
 */
export const SECTION_STATUSES: Record<TrekSection, readonly BookingStatus[]> = {
  upcoming: [
    "INQUIRY",
    "ALTERNATIVE_PROPOSED",
    "CONFIRMED",
    "PAYMENT_PENDING",
    "PAID",
  ],
  active: ["ACTIVE"],
  completed: ["COMPLETED"],
};

/** Counts for each section, so the app can render tab badges from one call. */
export type SectionCounts = Record<TrekSection, number>;

/** Narrow an untrusted `?section=` query value, defaulting to `upcoming`. */
export function parseSection(value: unknown): TrekSection | null {
  if (value === undefined || value === null || value === "") return "upcoming";
  return TREK_SECTIONS.includes(value as TrekSection) ? (value as TrekSection) : null;
}

/* ── Small date/text helpers (exported so they can be unit-tested) ───────── */

/** One day expressed in milliseconds — used by every date helper below. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Render a `Date` as a bare `YYYY-MM-DD` string in UTC.
 *
 * Mobile clients only need the calendar day for these cards, and a 10-character
 * string is ~40% smaller than a full ISO timestamp. UTC keeps the value stable
 * no matter which timezone the server happens to run in.
 */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC of the day `date` falls on — the anchor for all day maths. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `date` shifted by `days` (negative goes backwards). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Whole calendar days between two dates, `to` minus `from`.
 * Both sides are snapped to midnight first so partial days never round oddly.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY);
}

/**
 * Last day of a trek. A 5-day trek starting on the 1st ends on the 5th, so we
 * add `durationDays - 1`, not `durationDays`.
 */
export function trekEndDate(startDate: Date, durationDays: number): Date {
  return addDays(startOfUtcDay(startDate), Math.max(1, durationDays) - 1);
}

/**
 * Cut `text` down to `max` characters, appending an ellipsis when it was cut.
 * Used to keep long itinerary descriptions from bloating a mobile payload.
 */
export function truncate(text: string | null | undefined, max = 140): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Turn Prisma's `Decimal` (or a string/number) into a plain JS number.
 * Prisma serializes `Decimal` as an object, which would both bloat the payload
 * and force the mobile app to parse it — a number is smaller and simpler.
 */
export function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ── 1. Trekker dashboard ────────────────────────────────────────────────── */

/** One card on the trekker's "My treks" screen. Flat by design. */
export interface TrekkerTrekSummary {
  bookingId: string;
  status: string;
  packageTitle: string;
  packageSlug: string;
  agencyName: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  groupSize: number;
  totalPrice: number;
  /** Negative once the trek has started — lets the app show "in 12 days". */
  daysUntilStart: number;
}

export interface TrekkerDashboard {
  trekkerId: string;
  section: TrekSection;
  counts: SectionCounts;
  data: TrekkerTrekSummary[];
  meta: PageMeta;
}

/**
 * The exact columns a trekker card needs — nothing more.
 *
 * Naming a `select` (instead of `include`) is what actually makes the payload
 * slim: Prisma only reads these columns from Postgres, so the wide `Booking`
 * row (special requests, rejection reason, contact details, timestamps…) never
 * leaves the database.
 */
const TREKKER_TREK_SELECT = {
  id: true,
  status: true,
  groupSize: true,
  totalPrice: true,
  package: { select: { title: true, slug: true, durationDays: true } },
  agency: { select: { name: true } },
  departureDate: { select: { startDate: true } },
} as const;

/** The shape `TREKKER_TREK_SELECT` produces — declared so mappers stay typed. */
export interface TrekkerTrekRow {
  id: string;
  status: string;
  groupSize: number;
  totalPrice: unknown;
  package: { title: string; slug: string; durationDays: number } | null;
  agency: { name: string } | null;
  departureDate: { startDate: Date } | null;
}

/** Map one database row onto the flat card the mobile app renders. */
export function mapTrekkerTrek(row: TrekkerTrekRow, now: Date): TrekkerTrekSummary {
  const durationDays = row.package?.durationDays ?? 1;
  const start = row.departureDate ? startOfUtcDay(row.departureDate.startDate) : startOfUtcDay(now);

  return {
    bookingId: row.id,
    status: row.status,
    packageTitle: row.package?.title ?? "",
    packageSlug: row.package?.slug ?? "",
    agencyName: row.agency?.name ?? "",
    startDate: toDateOnly(start),
    endDate: toDateOnly(trekEndDate(start, durationDays)),
    durationDays,
    groupSize: row.groupSize,
    totalPrice: toNumber(row.totalPrice),
    daysUntilStart: daysBetween(now, start),
  };
}

/**
 * Fold Prisma's `groupBy` result (one row per status) into per-section counts.
 * One database round-trip gives us all three tab badges *and* the `total` for
 * the current section's pagination envelope — no extra `count()` query.
 */
export function countsFromStatusGroups(
  groups: { status: string; _count: { _all: number } }[]
): SectionCounts {
  const counts: SectionCounts = { upcoming: 0, active: 0, completed: 0 };

  for (const group of groups) {
    for (const section of TREK_SECTIONS) {
      // Widened to `string[]` so an unknown/legacy status value simply matches
      // nothing instead of failing to compile.
      const statuses = SECTION_STATUSES[section] as readonly string[];
      if (statuses.includes(group.status)) {
        counts[section] += group._count._all;
      }
    }
  }

  return counts;
}

/**
 * `GET /mobile/trekker/dashboard` — one call, everything the home screen needs.
 *
 * @param userId  `User.id` from the JWT (not `Trekker.id` — we resolve that).
 * @param section which bucket to list.
 * @param page    validated pagination request.
 * @param now     injectable "current time", so tests are deterministic.
 */
export async function getTrekkerDashboard(
  userId: string,
  section: TrekSection,
  page: PageRequest,
  now: Date = new Date()
): Promise<TrekkerDashboard> {
  // The JWT carries the platform-level `User.id`; bookings hang off `Trekker`.
  const trekker = await db.trekker.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!trekker) {
    const error = new Error("Trekker profile not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  const where = { trekkerId: trekker.id };

  // Two queries run in parallel: the badge counts and the current page of rows.
  const [groups, rows] = await Promise.all([
    db.booking.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    db.booking.findMany({
      where: { ...where, status: { in: [...SECTION_STATUSES[section]] } },
      select: TREKKER_TREK_SELECT,
      // Upcoming/active read best soonest-first; completed reads best
      // most-recent-first, which is what a history list should show.
      orderBy: { departureDate: { startDate: section === "completed" ? "desc" : "asc" } },
      skip: page.skip,
      take: page.take,
    }),
  ]);

  const counts = countsFromStatusGroups(
    groups as unknown as { status: string; _count: { _all: number } }[]
  );

  return {
    trekkerId: trekker.id,
    section,
    counts,
    data: (rows as unknown as TrekkerTrekRow[]).map((row) => mapTrekkerTrek(row, now)),
    meta: buildMeta(counts[section], page.page, page.limit),
  };
}

/* ── 2. Guide dashboard ──────────────────────────────────────────────────── */

/**
 * How far back to look for treks that might still be running today.
 * A trek longer than this would drop off "today's itinerary"; 90 days is well
 * past the longest commercial Himalayan itinerary, so it is a safe window that
 * keeps the query bounded instead of scanning the whole booking history.
 */
export const MAX_TREK_LOOKBACK_DAYS = 90;

/**
 * Ceiling on how many treks "today's itinerary" will return. A guide realistically
 * leads one trek at a time; the cap exists so a bad data state can never turn
 * this into an unbounded payload.
 */
export const TODAY_ITINERARY_CAP = 20;

/** Statuses that mean "this trek is paid for and either running or about to". */
const IN_FIELD_STATUSES = ["PAID", "ACTIVE"] as const;

/** One card on the guide's "My treks" screen. */
export interface GuideTrekSummary {
  bookingId: string;
  status: string;
  packageTitle: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  groupSize: number;
  trekkerName: string;
  trekkerPhone: string;
  daysUntilStart: number;
}

/** One row of "what am I doing today", resolved from the trek's itinerary. */
export interface GuideTodayItem {
  bookingId: string;
  packageTitle: string;
  /** Which day of the trek today is: 1-based. */
  dayNumber: number;
  totalDays: number;
  location: string | null;
  altitudeM: number | null;
  /** Itinerary description, truncated for bandwidth. */
  note: string | null;
  groupSize: number;
  trekkerName: string;
  trekkerPhone: string;
}

export interface GuideDashboard {
  guide: { userId: string; agencyUserId: string | null; staffId: string | null };
  section: TrekSection;
  counts: SectionCounts;
  today: { date: string; total: number; itinerary: GuideTodayItem[] };
  data: GuideTrekSummary[];
  meta: PageMeta;
}

const GUIDE_TREK_SELECT = {
  id: true,
  status: true,
  groupSize: true,
  trekkerName: true,
  trekkerPhone: true,
  packageId: true,
  package: { select: { title: true, durationDays: true } },
  departureDate: { select: { startDate: true } },
} as const;

export interface GuideTrekRow {
  id: string;
  status: string;
  groupSize: number;
  trekkerName: string;
  trekkerPhone: string;
  packageId: string;
  package: { title: string; durationDays: number } | null;
  departureDate: { startDate: Date } | null;
}

/** Map one database row onto the flat guide card. */
export function mapGuideTrek(row: GuideTrekRow, now: Date): GuideTrekSummary {
  const durationDays = row.package?.durationDays ?? 1;
  const start = row.departureDate ? startOfUtcDay(row.departureDate.startDate) : startOfUtcDay(now);

  return {
    bookingId: row.id,
    status: row.status,
    packageTitle: row.package?.title ?? "",
    startDate: toDateOnly(start),
    endDate: toDateOnly(trekEndDate(start, durationDays)),
    durationDays,
    groupSize: row.groupSize,
    trekkerName: row.trekkerName,
    trekkerPhone: row.trekkerPhone,
    daysUntilStart: daysBetween(now, start),
  };
}

/**
 * Work out which identifiers can appear in `Booking.assignedGuideId` for the
 * logged-in user.
 *
 * `Booking.assignedGuideId` is a bare string column with no foreign key (there
 * is no dedicated `Guide` model yet), and different parts of the platform have
 * historically referenced a guide by `User.id`, by `AgencyUser.id`, or by
 * `AgencyStaff.id`. Rather than guess one and silently return an empty
 * dashboard, we resolve **all three** ids for this user and match against the
 * set. When a first-class `Guide` model lands, this collapses to one id.
 *
 * The `AgencyUser` lookup is scoped by `agencyId` from the JWT and is also the
 * membership check: if this user has no `AgencyUser` row inside that agency
 * they are not a member of it, so we return **no** candidate ids at all and the
 * caller renders an empty dashboard. That keeps the lookup from ever resolving
 * an identity belonging to another tenant.
 */
export async function resolveGuideIdentity(
  userId: string,
  agencyId: string
): Promise<{ userId: string; agencyUserId: string | null; staffId: string | null; candidateIds: string[] }> {
  const agencyUser = await db.agencyUser.findFirst({
    where: { userId, agencyId },
    select: {
      id: true,
      agencyStaffs: { select: { id: true }, take: 1 },
    },
  });

  // Not a member of this agency → no identity, and therefore no treks.
  if (!agencyUser) {
    return { userId, agencyUserId: null, staffId: null, candidateIds: [] };
  }

  const agencyUserId = agencyUser.id;
  const staffId = agencyUser.agencyStaffs?.[0]?.id ?? null;

  // `filter(Boolean)` drops the null staff id; the cast tells TypeScript the
  // survivors are all strings.
  const candidateIds = [userId, agencyUserId, staffId].filter(Boolean) as string[];

  return { userId, agencyUserId, staffId, candidateIds };
}

/**
 * Build "today's itinerary" for a guide.
 *
 * Postgres cannot compute the end date for us (`durationDays` lives on
 * `TrekPackage`, the start date on `TrekDepartureDate`), so we do it in two
 * cheap steps:
 *
 *   1. Ask Postgres for in-field bookings whose start date falls inside a
 *      bounded window — from 90 days ago up to and including today.
 *   2. In JS, compute `dayNumber = daysSinceStart + 1` and keep only the treks
 *      where that day actually falls inside the itinerary.
 *
 * Then one more query fetches just the matching itinerary rows.
 */
export async function getGuideTodayItinerary(
  candidateIds: string[],
  agencyId: string,
  now: Date
): Promise<GuideTodayItem[]> {
  if (candidateIds.length === 0) return [];

  const today = startOfUtcDay(now);
  const windowStart = addDays(today, -MAX_TREK_LOOKBACK_DAYS);

  const rows = (await db.booking.findMany({
    where: {
      agencyId,
      assignedGuideId: { in: candidateIds },
      status: { in: [...IN_FIELD_STATUSES] },
      departureDate: { startDate: { gte: windowStart, lte: addDays(today, 1) } },
    },
    select: GUIDE_TREK_SELECT,
    orderBy: { departureDate: { startDate: "asc" } },
    take: TODAY_ITINERARY_CAP,
  })) as unknown as GuideTrekRow[];

  // Keep only treks where today is genuinely one of the itinerary days.
  const running = rows
    .map((row) => {
      const durationDays = row.package?.durationDays ?? 1;
      const start = row.departureDate ? startOfUtcDay(row.departureDate.startDate) : null;
      const dayNumber = start ? daysBetween(start, today) + 1 : 0;
      return { row, durationDays, dayNumber };
    })
    .filter(({ dayNumber, durationDays }) => dayNumber >= 1 && dayNumber <= durationDays);

  if (running.length === 0) return [];

  // One query for every (package, day) pair we need — not one per trek.
  const itineraries = (await db.trekItinerary.findMany({
    where: {
      OR: running.map(({ row, dayNumber }) => ({
        packageId: row.packageId,
        dayNumber,
      })),
    },
    select: {
      packageId: true,
      dayNumber: true,
      location: true,
      altitudeM: true,
      description: true,
    },
  })) as unknown as {
    packageId: string;
    dayNumber: number;
    location: string | null;
    altitudeM: number | null;
    description: string | null;
  }[];

  // Index them so the join below is O(1) per trek instead of a nested scan.
  const byKey = new Map(itineraries.map((it) => [`${it.packageId}:${it.dayNumber}`, it]));

  return running.map(({ row, durationDays, dayNumber }) => {
    const day = byKey.get(`${row.packageId}:${dayNumber}`);

    return {
      bookingId: row.id,
      packageTitle: row.package?.title ?? "",
      dayNumber,
      totalDays: durationDays,
      location: day?.location ?? null,
      altitudeM: day?.altitudeM ?? null,
      // `photos` is deliberately not selected — image URLs are the single
      // heaviest field on this model and the dashboard does not render them.
      note: truncate(day?.description),
      groupSize: row.groupSize,
      trekkerName: row.trekkerName,
      trekkerPhone: row.trekkerPhone,
    };
  });
}

/**
 * `GET /mobile/guide/dashboard` — assigned treks + what the guide is doing today.
 *
 * @param userId   `User.id` from the JWT.
 * @param agencyId tenant id from the JWT — every query below is scoped by it.
 */
export async function getGuideDashboard(
  userId: string,
  agencyId: string,
  section: TrekSection,
  page: PageRequest,
  now: Date = new Date()
): Promise<GuideDashboard> {
  const identity = await resolveGuideIdentity(userId, agencyId);

  // No identity resolved → the user is not a guide in this agency. That is an
  // empty dashboard, not an error: a newly invited guide with no treks yet
  // should see an empty state, not a failure screen.
  if (identity.candidateIds.length === 0) {
    return {
      guide: { userId, agencyUserId: null, staffId: null },
      section,
      counts: { upcoming: 0, active: 0, completed: 0 },
      today: { date: toDateOnly(now), total: 0, itinerary: [] },
      data: [],
      meta: buildMeta(0, page.page, page.limit),
    };
  }

  const where = {
    agencyId, // tenant isolation — never widen this
    assignedGuideId: { in: identity.candidateIds },
  };

  const [groups, rows, itinerary] = await Promise.all([
    db.booking.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.booking.findMany({
      where: { ...where, status: { in: [...SECTION_STATUSES[section]] } },
      select: GUIDE_TREK_SELECT,
      orderBy: { departureDate: { startDate: section === "completed" ? "desc" : "asc" } },
      skip: page.skip,
      take: page.take,
    }),
    getGuideTodayItinerary(identity.candidateIds, agencyId, now),
  ]);

  const counts = countsFromStatusGroups(
    groups as unknown as { status: string; _count: { _all: number } }[]
  );

  return {
    guide: {
      userId: identity.userId,
      agencyUserId: identity.agencyUserId,
      staffId: identity.staffId,
    },
    section,
    counts,
    today: { date: toDateOnly(now), total: itinerary.length, itinerary },
    data: (rows as unknown as GuideTrekRow[]).map((row) => mapGuideTrek(row, now)),
    meta: buildMeta(counts[section], page.page, page.limit),
  };
}
