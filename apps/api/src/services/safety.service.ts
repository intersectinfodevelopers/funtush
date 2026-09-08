import { ObjectId } from "mongodb";
import { getSosCollection, ACK_SLA_MINUTES, type SosIncident } from "../models/sosIncident.model.js";
import { exportIncident } from "./sosMonitoring.service.js";

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
  const incidents = rows.map(decorate);
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
    incidents: rows.map(decorate),
  };
}

export async function getIncident(agencyId: string, incidentId: string) {
  return decorate(await loadOwned(agencyId, incidentId));
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
  const text = (resolution ?? "").trim();
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
  const text = (note ?? "").trim();
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
