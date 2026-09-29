import { ObjectId, type Filter } from "mongodb";
import { getSosCollection, ACK_SLA_MINUTES, type SosIncident } from "../models/sosIncident.model";
import { prisma } from "../packages/database/prisma";

// ── Helpers ───────────────────────────────────────────────────────────────────

function minutesSince(date: Date): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 60000);
}

/**
 * Decorate an incident with computed fields the admin dashboard needs:
 * time since triggered, acknowledgment overdue flag (red timer).
 */
function decorate(incident: SosIncident) {
  const minutesSinceTriggered = minutesSince(incident.triggered_at);
  const acknowledged = incident.acknowledged_at !== null;
  const overdue = !acknowledged && minutesSinceTriggered >= ACK_SLA_MINUTES;

  return {
    id:                    incident._id?.toString(),
    agency_id:             incident.agency_id,
    agency_name:           incident.agency_name,
    guide_name:            incident.guide_name,
    trekker_name:          incident.trekker_name,
    coordinates:           incident.coordinates,
    status:                incident.status,
    triggered_at:          incident.triggered_at,
    acknowledged_at:       incident.acknowledged_at,
    minutesSinceTriggered,
    acknowledged,
    acknowledgmentOverdue: overdue,   // dashboard turns the timer red when true
    slaMinutes:            ACK_SLA_MINUTES,
  };
}

// ── Live feed of active incidents ───────────────────────────────────────────────

export async function getActiveIncidents() {
  const col = await getSosCollection();
  const incidents = await col
    .find({ status: { $in: ["ACTIVE", "ACKNOWLEDGED"] } })
    .sort({ triggered_at: 1 })  // oldest first — most urgent at top
    .toArray();

  const decorated = incidents.map(decorate);
  return {
    generatedAt:  new Date().toISOString(),
    activeCount:  decorated.length,
    overdueCount: decorated.filter((i) => i.acknowledgmentOverdue).length,
    incidents:    decorated,
  };
}

// ── Incident history ────────────────────────────────────────────────────────────

export async function getIncidentHistory(page = 1, limit = 20) {
  const col = await getSosCollection();
  const filter: Filter<SosIncident> = { status: { $in: ["RESOLVED", "CANCELLED"] } };
  const skip = (Math.max(page, 1) - 1) * limit;

  const [incidents, total] = await Promise.all([
    col.find(filter).sort({ triggered_at: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    count:       incidents.length,
    incidents:   incidents.map((i) => ({
      id:           i._id?.toString(),
      agency_name:  i.agency_name,
      guide_name:   i.guide_name,
      trekker_name: i.trekker_name,
      coordinates:  i.coordinates,
      status:       i.status,
      triggered_at: i.triggered_at,
      resolved_at:  i.resolved_at,
      resolution:   i.resolution,
      timeline:     i.timeline,
    })),
    meta: {
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// ── Add admin observation note ────────────────────────────────────────────────

export async function addAdminNote(incidentId: string, adminId: string, note: string) {
  if (!note || note.trim() === "") throw new Error("note is required");
  if (!ObjectId.isValid(incidentId)) throw new Error("Incident not found");
  const col = await getSosCollection();
  const _id = new ObjectId(incidentId);

  const now = new Date();
  const result = await col.updateOne(
    { _id },
    {
      $push: {
        admin_notes: { at: now, admin_id: adminId, note: note.trim() },
        timeline:    { at: now, event: "NOTE_ADDED", actor: adminId, detail: note.trim() },
      },
    }
  );
  if (result.matchedCount === 0) throw new Error("Incident not found");
  return { incidentId, addedAt: now.toISOString() };
}

// ── Get single incident (for export) ────────────────────────────────────────────

export async function getIncidentById(incidentId: string) {
  if (!ObjectId.isValid(incidentId)) return null;
  const col = await getSosCollection();
  return col.findOne({ _id: new ObjectId(incidentId) });
}

/**
 * Structured export for law enforcement — full incident record with
 * complete timeline, coordinates, and all parties identified.
 */
export async function exportIncident(incidentId: string) {
  const incident = await getIncidentById(incidentId);
  if (!incident) throw new Error("Incident not found");

  return {
    exportedAt:   new Date().toISOString(),
    incidentId:   incident._id?.toString(),
    agency: {
      id:   incident.agency_id,
      name: incident.agency_name,
    },
    guide: {
      id:   incident.guide_id,
      name: incident.guide_name,
    },
    trekker: {
      id:   incident.trekker_id,
      name: incident.trekker_name,
    },
    location:     incident.coordinates,
    status:       incident.status,
    triggeredAt:  incident.triggered_at,
    acknowledgedAt: incident.acknowledged_at,
    resolvedAt:   incident.resolved_at,
    resolution:   incident.resolution,
    fullTimeline: incident.timeline,
    adminNotes:   incident.admin_notes,
  };
}

// ── Formal safety warning (permanent, in PostgreSQL) ──────────────────────────

export async function issueSafetyWarning(
  agencyId: string,
  adminId: string,
  reason: string
) {
  if (!reason || reason.trim() === "") throw new Error("reason is required");

  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { id: true, name: true },
  });
  if (!agency) throw new Error("Agency not found");

  // Stored permanently in PostgreSQL safety_warnings table
  const warning = await prisma.safetyWarning.create({
    data: {
      agencyId,
      issuedBy: adminId,
      reason:   reason.trim(),
    },
    select: { id: true, agencyId: true, reason: true, createdAt: true },
  });

  return warning;
}