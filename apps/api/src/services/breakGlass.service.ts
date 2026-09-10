// ─────────────────────────────────────────────────────────────────────────────
// Break-Glass emergency access (Concept doc §4).
//
// A platform admin requests time-limited access to an agency's workspace for
// incident response. The raw token is returned once; only its SHA-256 hash is
// stored, mirrored in Redis with a TTL for fast verification. Every issue / use
// / revoke is written to the immutable audit log, the agency is notified, and
// the agency can see the history (GET /agencies/me/break-glass).
//
// NOT covered here: instrumenting every admin data-access path to record which
// records were viewed under a live token ("accessed-data audit") — that is a
// cross-cutting follow-up.
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes } from "crypto";
import { db } from "@funtush/database";
import { hashToken } from "@funtush/auth";
import { cacheSet, cacheDel } from "./redis.service.js";
import { writeAuditLog } from "./auditLog.service.js";
import { emailService } from "./emailService.js";

const DEFAULT_TTL_SECONDS = 30 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const cacheKey = (tokenHash: string) => `break-glass:${tokenHash}`;

export class BreakGlassError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "BreakGlassError";
  }
}

type Row = Awaited<ReturnType<typeof db.breakGlassToken.findUniqueOrThrow>> & {
  agency?: { id: string; name: string; email: string };
};

type BreakGlassStatus = "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";

function statusOf(r: { revokedAt: Date | null; expiresAt: Date; usedAt: Date | null }): BreakGlassStatus {
  if (r.revokedAt) return "REVOKED";
  if (r.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return r.usedAt ? "USED" : "ACTIVE";
}

function toApi(r: Row) {
  return {
    id: r.id,
    agencyId: r.agencyId,
    ...(r.agency ? { agency: r.agency } : {}),
    issuedBy: r.issuedBy,
    issuedByIp: r.issuedByIp,
    reason: r.reason,
    expiresAt: r.expiresAt,
    usedAt: r.usedAt,
    revokedAt: r.revokedAt,
    revokedByIp: r.revokedByIp,
    createdAt: r.createdAt,
    status: statusOf(r),
  };
}

export interface IssueInput {
  issuedByIp: string;
  issuedBy?: string | null;
  reason?: string | null;
  ttlSeconds?: number;
}

/** Issue a token. Returns the raw token ONCE — it is never retrievable again. */
export async function issueBreakGlass(agencyId: string, input: IssueInput) {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { id: true, name: true, email: true },
  });
  if (!agency) throw new BreakGlassError(404, "Agency not found");

  const raw = randomBytes(32).toString("hex");
  const tokenHash = hashToken(raw);
  const ttl =
    input.ttlSeconds && input.ttlSeconds > 0
      ? Math.min(Math.floor(input.ttlSeconds), MAX_TTL_SECONDS)
      : DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const record = await db.breakGlassToken.create({
    data: {
      agencyId,
      tokenHash,
      issuedByIp: input.issuedByIp,
      issuedBy: input.issuedBy ?? null,
      reason: input.reason?.trim() || null,
      expiresAt,
    },
  });

  await cacheSet(cacheKey(tokenHash), { agencyId, breakGlassId: record.id }, ttl);

  void writeAuditLog({
    action: "BREAK_GLASS_ISSUED",
    actor_id: input.issuedBy ?? "platform-admin",
    actor_ip: input.issuedByIp,
    target_type: "agency",
    target_id: agencyId,
    reason: record.reason,
    metadata: { breakGlassId: record.id, expiresAt: expiresAt.toISOString() },
  });

  void emailService
    .sendBreakGlassInitiatedEmail(agency.email, {
      firstName: agency.name,
      incidentType: "Emergency support access",
      timestamp: new Date().toISOString(),
      location: input.issuedByIp,
      statusUrl: `${process.env.APP_URL ?? ""}/dashboard/settings`,
    })
    .catch((e) => console.error("[break-glass] agency notification failed:", e));

  return { token: raw, expiresAt, breakGlass: toApi(record as Row) };
}

/**
 * Validate a raw token. Returns the agency context if the token is live
 * (exists, not expired, not revoked); records first use. Null otherwise.
 */
export async function verifyBreakGlass(
  rawToken: string,
): Promise<{ agencyId: string; breakGlassId: string } | null> {
  if (!rawToken) return null;
  const row = await db.breakGlassToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  if (!row.usedAt) {
    await db.breakGlassToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    void writeAuditLog({
      action: "BREAK_GLASS_USED",
      actor_id: row.issuedBy ?? "platform-admin",
      actor_ip: row.issuedByIp,
      target_type: "agency",
      target_id: row.agencyId,
      metadata: { breakGlassId: row.id },
    });
  }
  return { agencyId: row.agencyId, breakGlassId: row.id };
}

export async function revokeBreakGlass(id: string, revokedByIp: string) {
  const row = await db.breakGlassToken.findUnique({ where: { id } });
  if (!row) throw new BreakGlassError(404, "Break-glass token not found");
  if (row.revokedAt) throw new BreakGlassError(409, "Break-glass token is already revoked");

  const updated = await db.breakGlassToken.update({
    where: { id },
    data: { revokedAt: new Date(), revokedByIp },
  });
  await cacheDel(cacheKey(row.tokenHash));

  void writeAuditLog({
    action: "BREAK_GLASS_REVOKED",
    actor_id: "platform-admin",
    actor_ip: revokedByIp,
    target_type: "agency",
    target_id: row.agencyId,
    metadata: { breakGlassId: id },
  });
  return toApi(updated as Row);
}

/** Admin view. Without agencyId, includes the agency summary on each row. */
export async function listBreakGlass(opts: { agencyId?: string; activeOnly?: boolean } = {}) {
  const rows = await db.breakGlassToken.findMany({
    where: {
      ...(opts.agencyId ? { agencyId: opts.agencyId } : {}),
      ...(opts.activeOnly ? { revokedAt: null, expiresAt: { gt: new Date() } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    ...(opts.agencyId ? {} : { include: { agency: { select: { id: true, name: true, email: true } } } }),
  });
  return (rows as Row[]).map(toApi);
}

/** Agency-facing transparency view — no token hash, no admin IP. */
export async function getAgencyBreakGlassHistory(agencyId: string) {
  const rows = await db.breakGlassToken.findMany({
    where: { agencyId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    issuedAt: r.createdAt,
    expiresAt: r.expiresAt,
    usedAt: r.usedAt,
    revokedAt: r.revokedAt,
    status: statusOf(r),
  }));
}
