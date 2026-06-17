import { getAuditCollection, type AuditAction } from "../models/auditLog.model";

/**
 * Write an immutable audit log entry. Fire-and-forget safe — never throws,
 * so a logging failure can't break the admin action itself.
 */
export async function writeAuditLog(params: {
  action:      AuditAction;
  actor_id:    string;
  actor_ip:    string;
  target_type: string;
  target_id:   string;
  reason?:     string | null;
  metadata?:   Record<string, unknown>;
}): Promise<void> {
  try {
    const col = await getAuditCollection();
    await col.insertOne({
      action:      params.action,
      actor_id:    params.actor_id,
      actor_ip:    params.actor_ip,
      target_type: params.target_type,
      target_id:   params.target_id,
      reason:      params.reason ?? null,
      metadata:    params.metadata ?? {},
      timestamp:   new Date(),
    });
  } catch (err) {
    console.error("[Audit] Failed to write audit log:", err);
  }
}

/**
 * Read audit logs, newest first, optionally filtered by target or actor.
 */
export async function getAuditLogs(filter: {
  target_type?: string;
  target_id?:   string;
  actor_id?:    string;
  action?:      AuditAction;
  limit?:       number;
} = {}) {
  const col   = await getAuditCollection();
  const query: Record<string, unknown> = {};
  if (filter.target_type) query.target_type = filter.target_type;
  if (filter.target_id)   query.target_id   = filter.target_id;
  if (filter.actor_id)    query.actor_id    = filter.actor_id;
  if (filter.action)      query.action      = filter.action;

  return col.find(query).sort({ timestamp: -1 }).limit(filter.limit ?? 100).toArray();
}
