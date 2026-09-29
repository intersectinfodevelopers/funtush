import crypto from "node:crypto";
import { db } from "@funtush/database";
import { hashToken } from "@funtush/auth";
import { httpError } from "../utils/httpError";
import { assertStrongPassword, setUserPassword } from "./passwordReset.service";
import { writeAuditLog } from "./auditLog.service";
import { sendBreakGlassIssuedEmail, sendPasswordChangedEmail } from "../utils/email";

/**
 * Break-glass = admin-authorised account recovery for an agency whose owner can
 * no longer use "Forgot password" (mailbox lost, address changed, …).
 *
 *  1. A super/platform admin issues a code for an agency, with a mandatory reason.
 *     The raw code is returned ONCE, to that admin, who hands it to the verified
 *     owner out-of-band (phone/in person). It is never emailed — the mailbox may
 *     be exactly what is compromised or lost.
 *  2. The owner redeems it at POST /auth/break-glass/redeem and chooses a new
 *     password. That is all it can do: it is not a session and grants no access
 *     by itself.
 *  3. Single use, 30 minutes, hash-only at rest, one live code per agency,
 *     revocable, and every step is audit-logged. Redeeming revokes all the
 *     owner's existing sessions.
 *
 * The owner is notified by email that recovery was started (without the code) and
 * that the password changed, so a misuse cannot be silent.
 */

export const BREAK_GLASS_TTL_SECONDS = 30 * 60;

export async function issueBreakGlassToken(params: { agencyId: string; adminId: string; ip: string; reason: string }) {
  const reason = params.reason?.trim();
  if (!reason) throw httpError(400, "reason is required");

  const agency = await db.agency.findUnique({ where: { id: params.agencyId }, select: { id: true, name: true, status: true } });
  if (!agency) throw httpError(404, "Agency not found");
  if (agency.status === "BANNED") throw httpError(403, "Cannot recover a banned agency");

  const owner = await db.agencyUser.findFirst({
    where: { agencyId: agency.id, role: "AGENCY_ADMIN" },
    orderBy: { joinedAt: "asc" },
    select: { user: { select: { id: true, email: true } } },
  });
  if (!owner) throw httpError(404, "Agency has no AGENCY_ADMIN user");

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + BREAK_GLASS_TTL_SECONDS * 1000);

  // One live code per agency: issuing again kills any earlier unused one.
  await db.$transaction([
    db.breakGlassToken.updateMany({
      where: { agencyId: agency.id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    db.breakGlassToken.create({
      data: {
        token: hashToken(token),
        agencyId: agency.id,
        userId: owner.user.id,
        issuedBy: params.adminId,
        reason,
        issuedByIp: params.ip,
        expiresAt,
      },
    }),
  ]);

  await writeAuditLog({
    action: "BREAK_GLASS_ISSUED", actor_id: params.adminId, actor_ip: params.ip,
    target_type: "agency", target_id: agency.id, reason,
    metadata: { expiresAt: expiresAt.toISOString(), ownerUserId: owner.user.id },
  });
  void sendBreakGlassIssuedEmail(owner.user.email, agency.name, reason, expiresAt);

  return { token, expiresAt: expiresAt.toISOString(), ttlSeconds: BREAK_GLASS_TTL_SECONDS, agencyId: agency.id, agencyName: agency.name };
}

export async function revokeBreakGlass(params: { agencyId: string; adminId: string; ip: string }) {
  const { count } = await db.breakGlassToken.updateMany({
    where: { agencyId: params.agencyId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
  await writeAuditLog({
    action: "BREAK_GLASS_REVOKED", actor_id: params.adminId, actor_ip: params.ip,
    target_type: "agency", target_id: params.agencyId, metadata: { revoked: count },
  });
  return { revoked: count };
}

export async function redeemBreakGlass(rawToken: unknown, newPassword: unknown, ip: string) {
  if (typeof rawToken !== "string" || !/^[a-f0-9]{64}$/.test(rawToken)) {
    throw httpError(400, "Invalid or expired recovery code");
  }
  // Fail on a weak password BEFORE consuming the code, so a typo doesn't burn it.
  assertStrongPassword(newPassword);

  // Atomic claim: exactly one caller can flip usedAt from null.
  const now = new Date();
  const claimed = await db.breakGlassToken.updateMany({
    where: { token: hashToken(rawToken), usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) throw httpError(400, "Invalid or expired recovery code");

  const record = await db.breakGlassToken.findUnique({ where: { token: hashToken(rawToken) } });
  if (!record?.userId) throw httpError(400, "Invalid or expired recovery code");

  const { email } = await setUserPassword(record.userId, newPassword, ip);

  await writeAuditLog({
    action: "BREAK_GLASS_USED", actor_id: record.userId, actor_ip: ip,
    target_type: "agency", target_id: record.agencyId,
    metadata: { issuedBy: record.issuedBy, tokenId: record.id },
  });
  void sendPasswordChangedEmail(email, "emergency account recovery");
  return { success: true, message: "Password updated. Please sign in with your new password." };
}
