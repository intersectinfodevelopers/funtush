/**
 * Operator recovery for PLATFORM staff (SUPER_ADMIN / PLATFORM_ADMIN / PLATFORM_SUPPORT).
 *
 * Platform accounts deliberately have no email "Forgot password" and no
 * break-glass (their password guards the whole platform), so the only way back
 * in after a lost password is shell access to the server — which is the trust
 * boundary this script relies on.
 *
 *   npm run admin:reset-password -- admin@funtush.com
 *
 * Generates a strong random password, prints it once, revokes every session the
 * account holds, clears its lockout and writes an audit-log entry. Pass
 * NEW_ADMIN_PASSWORD=... to choose the password instead.
 */
import "dotenv/config";
import crypto from "node:crypto";
import { db } from "@funtush/database";
import { setUserPassword } from "../services/passwordReset.service";
import { writeAuditLog } from "../services/auditLog.service";

const PLATFORM_ROLES = ["SUPER_ADMIN", "PLATFORM_ADMIN", "PLATFORM_SUPPORT"];

function generatePassword(): string {
  // 24 random base64url chars + guaranteed class coverage to satisfy the policy.
  return `${crypto.randomBytes(18).toString("base64url")}aA1`;
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run admin:reset-password -- <email>");

  const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user || !PLATFORM_ROLES.includes(user.role)) {
    // Refuse agency/trekker accounts: those recover via Forgot password or break-glass.
    throw new Error("No platform-staff account with that email.");
  }

  const chosen = process.env.NEW_ADMIN_PASSWORD;
  const generated = chosen ?? generatePassword();
  await setUserPassword(user.id, generated);
  await writeAuditLog({
    action: "PASSWORD_RESET_CLI", actor_id: "operator-cli", actor_ip: "local",
    target_type: "user", target_id: user.id, reason: "Operator CLI reset",
  });

  // stdout for the operator, deliberately not a log call: the secret must never reach a log sink.
  process.stdout.write(`Credentials reset for ${email}. All sessions revoked.\n`);
  if (!chosen) process.stdout.write(`New credential (shown once): ${generated}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
