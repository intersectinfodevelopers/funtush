import { ObjectId } from "mongodb";
import { db } from "@funtush/database";
import { getSosCollection, ACK_SLA_MINUTES, type SosIncident } from "../models/sosIncident.model.js";
import { exportIncident } from "./sosMonitoring.service.js";
import { EMERGENCY_NUMBERS } from "../data/emergencyNumbers.js";
import { matchTrekRegion, type TrekRegionMatch } from "../data/trekRegionCoordinates.js";

/**
 * Agency-scoped safety / SOS incident management. Mirrors sosMonitoring.service
 * (which is platform-admin scoped) but every query is filtered by agency_id and
 * every incident id is checked against the calling agency before it is touched.
 */

export class SafetyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function minutesSince(date: Date): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 60000);
}

function decorate(i: SosIncident) {
  const minutesSinceTriggered = minutesSince(i.triggered_at);
  const acknowledged = i.acknowledged_at !== null;
  return {
    id: i._id?.toString(),
    guideName: i.guide_name,
    guideId: i.guide_id,
    trekkerName: i.trekker_name,
    coordinates: i.coordinates,
    status: i.status,
    triggeredAt: i.triggered_at,
    acknowledgedAt: i.acknowledged_at,
    resolvedAt: i.resolved_at,
    resolution: i.resolution,
    minutesSinceTriggered,
    acknowledged,
    acknowledgmentOverdue: !acknowledged && minutesSinceTriggered >= ACK_SLA_MINUTES,
    slaMinutes: ACK_SLA_MINUTES,
    notes: i.admin_notes ?? [],
    timeline: i.timeline ?? [],
  };
}

// SOS incidents store the guide only as `guide_id`/`guide_name` (no phone) —
// this looks up the real GuideProfile.phone so the dashboard can offer a
// genuine Call/WhatsApp button instead of a dead-end name.
async function guidePhonesByRef(agencyId: string, guideIds: Array<string | null>): Promise<Map<string, { phone: string; altPhone: string | null }>> {
  const refs = [...new Set(guideIds.filter((g): g is string => Boolean(g)))];
  if (refs.length === 0) return new Map();
  const rows = await db.guideProfile.findMany({ where: { agencyId, guideRef: { in: refs } }, select: { guideRef: true, phone: true, altPhone: true } });
  return new Map(rows.map((r) => [r.guideRef, { phone: r.phone, altPhone: r.altPhone }]));
}

async function withGuidePhones<T extends { guideId: string | null }>(agencyId: string, incidents: T[]): Promise<Array<T & { guidePhone: string | null; guideAltPhone: string | null }>> {
  const phones = await guidePhonesByRef(agencyId, incidents.map((i) => i.guideId));
  return incidents.map((i) => ({
    ...i,
    guidePhone: (i.guideId && phones.get(i.guideId)?.phone) || null,
    guideAltPhone: (i.guideId && phones.get(i.guideId)?.altPhone) || null,
  }));
}

const EMERGENCY_NUMBERS_BY_COUNTRY = new Map(EMERGENCY_NUMBERS.map((c) => [c.countryCode, c]));

export interface TrekContext {
  packageTitle: string;
  dayNumber: number | null;
  totalDays: number | null;
  /** The country the guide's current trek runs in — the emergency numbers apply to that trek, not the agency's own country. */
  emergencyCountry: string | null;
  emergencyPolice: string | null;
}

/**
 * SOS incidents carry a guide_id but no trekId — there's no direct link from an
 * incident to "which trek was this." What IS real: a guide can only be on one
 * ACTIVE (checked-in) trek at a time (enforced in guideAvailability.service.ts).
 * So if the guide named on this incident currently has an ACTIVE booking, that
 * booking almost certainly *is* the trek the incident happened on — this reads
 * that real booking instead of guessing or leaving the field blank.
 */
async function currentTreksByGuideRef(agencyId: string, guideIds: Array<string | null>): Promise<Map<string, TrekContext>> {
  const refs = [...new Set(guideIds.filter((g): g is string => Boolean(g)))];
  if (refs.length === 0) return new Map();

  const bookings = await db.booking.findMany({
    where: { agencyId, status: "ACTIVE", assignedGuideId: { in: refs } },
    select: {
      assignedGuideId: true,
      departureDate: { select: { startDate: true } },
      package: { select: { title: true, minDurationDays: true, maxDurationDays: true, countryCode: true } },
    },
  });

  const now = Date.now();
  const map = new Map<string, TrekContext>();
  for (const b of bookings) {
    if (!b.assignedGuideId || map.has(b.assignedGuideId)) continue; // one trek at a time — first match wins
    const start = b.departureDate?.startDate ?? null;
    const dayNumber = start ? Math.max(1, Math.floor((now - new Date(start).getTime()) / 86_400_000) + 1) : null;
    const emergency = b.package.countryCode ? EMERGENCY_NUMBERS_BY_COUNTRY.get(b.package.countryCode) : undefined;
    map.set(b.assignedGuideId, {
      packageTitle: b.package.title,
      dayNumber,
      totalDays: b.package.maxDurationDays ?? b.package.minDurationDays ?? null,
      emergencyCountry: emergency?.countryName ?? null,
      emergencyPolice: emergency?.police[0] ?? emergency?.universal ?? null,
    });
  }
  return map;
}

async function withTrekContext<T extends { guideId: string | null }>(agencyId: string, incidents: T[]): Promise<Array<T & { trek: TrekContext | null }>> {
  const treks = await currentTreksByGuideRef(agencyId, incidents.map((i) => i.guideId));
  return incidents.map((i) => ({ ...i, trek: (i.guideId && treks.get(i.guideId)) || null }));
}

async function loadOwned(agencyId: string, incidentId: string): Promise<SosIncident> {
  if (!ObjectId.isValid(incidentId)) throw new SafetyError(404, "Incident not found.");
  const col = await getSosCollection();
  const incident = await col.findOne({ _id: new ObjectId(incidentId) });
  if (!incident || incident.agency_id !== agencyId) {
    throw new SafetyError(404, "Incident not found.");
  }
  return incident;
}

export async function getActiveIncidents(agencyId: string) {
  const col = await getSosCollection();
  const rows = await col
    .find({ agency_id: agencyId, status: { $in: ["ACTIVE", "ACKNOWLEDGED"] } })
    .sort({ triggered_at: 1 })
    .toArray();
  const incidents = await withTrekContext(agencyId, await withGuidePhones(agencyId, rows.map(decorate)));
  return {
    generatedAt: new Date().toISOString(),
    activeCount: incidents.length,
    overdueCount: incidents.filter((i) => i.acknowledgmentOverdue).length,
    incidents,
  };
}

export async function getIncidentHistory(agencyId: string, limit = 100) {
  const col = await getSosCollection();
  const rows = await col
    .find({ agency_id: agencyId, status: { $in: ["RESOLVED", "CANCELLED"] } })
    .sort({ triggered_at: -1 })
    .limit(Math.min(500, Math.max(1, limit)))
    .toArray();
  return {
    generatedAt: new Date().toISOString(),
    count: rows.length,
    // Historical incidents' guides have very likely moved to a different (or no) trek
    // since — trek context is only meaningfully real for CURRENTLY open incidents.
    incidents: await withGuidePhones(agencyId, rows.map(decorate)),
  };
}

export async function getIncident(agencyId: string, incidentId: string) {
  const [withPhone] = await withGuidePhones(agencyId, [decorate(await loadOwned(agencyId, incidentId))]);
  const [decorated] = await withTrekContext(agencyId, [withPhone]);
  return decorated;
}

// ── Active treks (Backend Guide: real data only — no GPS/location-ping system exists yet,
// so this is "which guides are currently checked in on a trek right now", not a live map) ──

export interface ActiveTrek {
  bookingId: string;
  trekkerName: string;
  guideId: string | null;
  guideName: string | null;
  packageTitle: string;
  /** 1-based day of the trek, computed from the departure date; null if the departure has no date. */
  dayNumber: number | null;
  totalDays: number | null;
  hasActiveSos: boolean;
  /** Approximate route location — see data/trekRegionCoordinates.ts. Null when the package name doesn't match a known route (never guessed). */
  region: TrekRegionMatch | null;
}

export async function getActiveTreks(agencyId: string): Promise<ActiveTrek[]> {
  const bookings = await db.booking.findMany({
    where: { agencyId, status: "ACTIVE" },
    select: {
      id: true,
      trekkerName: true,
      assignedGuideId: true,
      departureDate: { select: { startDate: true } },
      package: { select: { title: true, minDurationDays: true, maxDurationDays: true, region: true, destination: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const guideRefs = [...new Set(bookings.map((b) => b.assignedGuideId).filter((g): g is string => Boolean(g)))];
  const guides = guideRefs.length
    ? await db.guideProfile.findMany({ where: { agencyId, guideRef: { in: guideRefs } }, select: { guideRef: true, fullName: true } })
    : [];
  const guideNameByRef = new Map(guides.map((g) => [g.guideRef, g.fullName]));

  const col = await getSosCollection();
  const openIncidents = await col.find({ agency_id: agencyId, status: { $in: ["ACTIVE", "ACKNOWLEDGED"] } }).toArray();
  const guideIdsWithSos = new Set(openIncidents.map((i) => i.guide_id).filter(Boolean));

  const now = Date.now();
  return bookings.map((b) => {
    const start = b.departureDate?.startDate ?? null;
    const dayNumber = start ? Math.max(1, Math.floor((now - new Date(start).getTime()) / 86_400_000) + 1) : null;
    return {
      bookingId: b.id,
      trekkerName: b.trekkerName,
      guideId: b.assignedGuideId,
      guideName: b.assignedGuideId ? (guideNameByRef.get(b.assignedGuideId) ?? null) : null,
      packageTitle: b.package.title,
      dayNumber,
      totalDays: b.package.maxDurationDays ?? b.package.minDurationDays ?? null,
      hasActiveSos: b.assignedGuideId ? guideIdsWithSos.has(b.assignedGuideId) : false,
      region: matchTrekRegion(b.package.title, b.package.region, b.package.destination),
    };
  });
}

export async function acknowledgeIncident(agencyId: string, incidentId: string, actorId: string) {
  const incident = await loadOwned(agencyId, incidentId);
  if (incident.status !== "ACTIVE") {
    throw new SafetyError(409, `Only an ACTIVE incident can be acknowledged (this one is ${incident.status}).`);
  }
  const col = await getSosCollection();
  const now = new Date();
  await col.updateOne(
    { _id: incident._id },
    {
      $set: { status: "ACKNOWLEDGED", acknowledged_at: now },
      $push: { timeline: { at: now, event: "ACKNOWLEDGED", actor: actorId } },
    },
  );
  return getIncident(agencyId, incidentId);
}

export async function resolveIncident(
  agencyId: string,
  incidentId: string,
  resolution: string,
  actorId: string,
) {
  const text = typeof resolution === "string" ? resolution.trim() : "";
  if (!text) throw new SafetyError(400, "A resolution note is required.");
  const incident = await loadOwned(agencyId, incidentId);
  if (incident.status === "RESOLVED" || incident.status === "CANCELLED") {
    throw new SafetyError(409, `This incident is already ${incident.status}.`);
  }
  const col = await getSosCollection();
  const now = new Date();
  await col.updateOne(
    { _id: incident._id },
    {
      $set: { status: "RESOLVED", resolved_at: now, resolution: text },
      $push: { timeline: { at: now, event: "RESOLVED", actor: actorId, detail: text } },
    },
  );
  return getIncident(agencyId, incidentId);
}

export async function addIncidentNote(
  agencyId: string,
  incidentId: string,
  note: string,
  actorId: string,
) {
  const text = typeof note === "string" ? note.trim() : "";
  if (!text) throw new SafetyError(400, "A note is required.");
  const incident = await loadOwned(agencyId, incidentId);
  const col = await getSosCollection();
  const now = new Date();
  await col.updateOne(
    { _id: incident._id },
    {
      $push: {
        admin_notes: { at: now, admin_id: actorId, note: text },
        timeline: { at: now, event: "NOTE_ADDED", actor: actorId, detail: text },
      },
    },
  );
  return getIncident(agencyId, incidentId);
}

export async function exportIncidentForAgency(agencyId: string, incidentId: string) {
  await loadOwned(agencyId, incidentId);
  return exportIncident(incidentId);
}
