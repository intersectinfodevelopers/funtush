import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";

/**
 * Who can be put on a trek. A guide on a trek can't be put on a DIFFERENT trek until they're free, but can take more
 * people on the SAME trek (same departure). The agency can always free a guide by hand (Guides → Edit → Available).
 *
 *  - Assigning a guide to a booking marks them busy ("On Trek", `autoBusy`).
 *  - They're freed automatically once none of their bookings is still active (done, cancelled, rejected…).
 *  - `Unavailable` (set by hand) blocks assignment until the agency makes them Available again.
 */
const ACTIVE_BOOKING = ["CONFIRMED", "PAYMENT_PENDING", "PAID", "ACTIVE"] as const;

/** Frees guides the system marked busy whose bookings have all ended. Cheap; safe to call often. */
export async function releaseIdleGuides(agencyId?: string): Promise<number> {
  const busy = await db.guideProfile.findMany({ where: { ...(agencyId ? { agencyId } : {}), autoBusy: true, status: "ON_TREK" }, select: { id: true, agencyId: true, guideRef: true } });
  if (busy.length === 0) return 0;
  const stillActive = await db.booking.findMany({
    where: { assignedGuideId: { in: busy.map((g) => g.guideRef) }, status: { in: [...ACTIVE_BOOKING] }, ...(agencyId ? { agencyId } : {}) },
    select: { agencyId: true, assignedGuideId: true },
  });
  const held = new Set(stillActive.map((b) => `${b.agencyId}:${b.assignedGuideId}`));
  const free = busy.filter((g) => !held.has(`${g.agencyId}:${g.guideRef}`)).map((g) => g.id);
  if (free.length === 0) return 0;
  await db.guideProfile.updateMany({ where: { id: { in: free }, autoBusy: true }, data: { status: "AVAILABLE", autoBusy: false } });
  return free.length;
}

export interface Assignability {
  ok: boolean;
  reason?: string;
  /** What the guide is busy with, when it's another trek. */
  busyWith?: { bookingId: string; title: string | null; date: Date | null };
}

/** Can this guide be put on (a booking of) `departureDateId`? `ignoreBookingId`: the booking being (re)assigned. */
export async function checkGuideAssignable(agencyId: string, guideRef: string, departureDateId: string, ignoreBookingId?: string): Promise<Assignability> {
  await releaseIdleGuides(agencyId);
  const guide = await db.guideProfile.findUnique({ where: { agencyId_guideRef: { agencyId, guideRef } }, select: { isActive: true, status: true, fullName: true } });
  if (!guide || !guide.isActive) return { ok: false, reason: "Guide not found or inactive" };
  if (guide.status === "UNAVAILABLE") return { ok: false, reason: `${guide.fullName} is marked unavailable. Make them Available in their guide profile first.` };
  if (guide.status === "ON_TREK") {
    const elsewhere = await db.booking.findFirst({
      where: { agencyId, assignedGuideId: guideRef, status: { in: [...ACTIVE_BOOKING] }, departureDateId: { not: departureDateId }, ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}) },
      select: { id: true, package: { select: { title: true } }, departureDate: { select: { startDate: true } } },
      orderBy: { departureDate: { startDate: "asc" } },
    });
    if (elsewhere) {
      const when = elsewhere.departureDate?.startDate ? ` on ${elsewhere.departureDate.startDate.toISOString().slice(0, 10)}` : "";
      return {
        ok: false,
        reason: `${guide.fullName} is already on another trek (${elsewhere.package?.title ?? "a trek"}${when}). They can only join that same trek until it is finished — or make them Available in their guide profile.`,
        busyWith: { bookingId: elsewhere.id, title: elsewhere.package?.title ?? null, date: elsewhere.departureDate?.startDate ?? null },
      };
    }
  }
  return { ok: true };
}

/** Throws a 409 (or 404) with a plain-words reason when the guide can't take this departure. */
export async function assertGuideAssignable(agencyId: string, guideRef: string, departureDateId: string, ignoreBookingId?: string): Promise<void> {
  const r = await checkGuideAssignable(agencyId, guideRef, departureDateId, ignoreBookingId);
  if (!r.ok) throw httpError(r.reason === "Guide not found or inactive" ? 404 : 409, r.reason ?? "This guide can't be assigned.");
}

/** Called after a guide is put on a booking. */
export async function markGuideBusy(agencyId: string, guideRef: string): Promise<void> {
  await db.guideProfile.updateMany({ where: { agencyId, guideRef, status: "AVAILABLE" }, data: { status: "ON_TREK", autoBusy: true } });
}

/** Every active guide with whether THIS departure can use them right now (and why not). */
export async function assignableGuidesFor(agencyId: string, departureDateId: string, ignoreBookingId?: string) {
  await releaseIdleGuides(agencyId);
  const guides = await db.guideProfile.findMany({ where: { agencyId, isActive: true }, orderBy: { fullName: "asc" }, select: { guideRef: true, fullName: true, status: true, phone: true } });
  const out = [];
  for (const g of guides) {
    const r = await checkGuideAssignable(agencyId, g.guideRef, departureDateId, ignoreBookingId);
    out.push({ guideRef: g.guideRef, name: g.fullName, phone: g.phone, status: g.status.toLowerCase(), assignable: r.ok, reason: r.ok ? null : r.reason });
  }
  return out;
}
