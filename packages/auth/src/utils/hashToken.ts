import crypto from "crypto";

/**
 * Hash refresh token before storing in DB
 * (security: prevents token theft from DB leak)
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}