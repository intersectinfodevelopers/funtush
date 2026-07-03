import { ObjectId } from "mongodb";
import { getMongo } from "../lib/mongo";

/**
 * Immutable audit log for all admin actions, stored in MongoDB.
 * Records are append-only — never updated or deleted.
 */

export const AUDIT_ACTIONS = [
  "AGENCY_TIER_CHANGED",
  "AGENCY_STATUS_CHANGED",
  "AGENCY_IMPERSONATED",
  "AGENCY_VIEWED",
  "KYC_APPROVED",
  "KYC_REJECTED",
  "BREAK_GLASS_ISSUED",
  "AGENCY_VISIBILITY_OVERRIDE_CHANGED",
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

export interface AuditLogEntry {
  _id?: ObjectId;
  action: AuditAction;
  actor_id: string;        // admin user id
  actor_ip: string;
  target_type: string;        // e.g. "agency"
  target_id: string;        // e.g. agency id
  reason: string | null; // mandatory for status changes
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export async function getAuditCollection() {
  const db = await getMongo();
  return db.collection<AuditLogEntry>("admin_audit_logs");
}

export async function ensureAuditIndexes(): Promise<void> {
  try {
    const col = await getAuditCollection();
    await col.createIndex({ timestamp: -1 });
    await col.createIndex({ actor_id: 1, timestamp: -1 });
    await col.createIndex({ target_type: 1, target_id: 1, timestamp: -1 });
    await col.createIndex({ action: 1, timestamp: -1 });
    console.log("[Audit] MongoDB indexes ensured");
  } catch (err) {
    console.error("[Audit] Failed to ensure indexes:", err);
  }
}
