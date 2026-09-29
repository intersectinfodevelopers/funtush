import crypto from "node:crypto";
import { db } from "@funtush/database";
import { normalizeEmail } from "@funtush/shared";
import { comparePassword, hashPassword, hashToken, revokeAllUserTokens, resetAttempts } from "@funtush/auth";
import { redis } from "../lib/redis";
import { httpError } from "../utils/httpError";
import { sendPasswordResetEmail, sendPasswordChangedEmail } from "../utils/email";

/**
 * Self-service password reset.
 *
 * - The emailed token is 256 random bits; only its SHA-256 is stored (Redis, 30
 *   min), so neither a Redis nor a DB read yields a usable link.
 * - Single use: redeemed with an atomic GETDEL.
 * - One live token per user — asking again invalidates the previous email.
 * - `requestPasswordReset` answers identically whether or not the account exists
 *   (no email enumeration) and is rate limited per email and per IP.
 * - Platform staff (SUPER_ADMIN / PLATFORM_*) are excluded on purpose: their
 *   password protects the whole platform, so mailbox-only recovery is too weak.
 *   They recover via the operator CLI (`npm run admin:reset-password`).
 * - A successful reset revokes every session the user holds.
 */

export const RESET_TTL_SECONDS = 30 * 60;
const NOT_SELF_SERVICE = ["SUPER_ADMIN", "PLATFORM_ADMIN", "PLATFORM_SUPPORT"];

const tokenKey = (hash: string) => `pwd-reset:${hash}`;
const userKey = (userId: string) => `pwd-reset:user:${userId}`;

const GENERIC = { success: true, message: "If that account exists, a reset link has been sent." };

/** Fixed-window counter. Returns false once `max` is exceeded. Fails open if Redis is down. */
async function withinLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSeconds);
    return n <= max;
  } catch {
    return true;
  }
}

/** Same rules as registration (validations/auth.validation.ts), plus bcrypt's 72-byte ceiling. */
export function assertStrongPassword(password: unknown): asserts password is string {
  if (typeof password !== "string") throw httpError(400, "Password is required");
  if (password.length < 8) throw httpError(400, "Password must be at least 8 characters");
  if (Buffer.byteLength(password) > 72) throw httpError(400, "Password must be at most 72 bytes");
  if (!/[A-Z]/.test(password)) throw httpError(400, "Password must contain an uppercase letter");
  if (!/[a-z]/.test(password)) throw httpError(400, "Password must contain a lowercase letter");
  if (!/[0-9]/.test(password)) throw httpError(400, "Password must contain a number");
}

/**
 * The one place a password is replaced. Shared by reset and break-glass so both
 * revoke sessions and clear lockouts identically.
 */
export async function setUserPassword(userId: string, newPassword: string, ip?: string): Promise<{ email: string }> {
  assertStrongPassword(newPassword);
  const passwordHash = await hashPassword(newPassword);

  const user = await db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data: { passwordHash }, select: { email: true } });
    await tx.refreshToken.deleteMany({ where: { userId } });
    return updated;
  });

  await revokeAllUserTokens(userId);
  await resetAttempts(user.email, ip); // email-wide lock + the caller's own (email, IP) lock
  return user;
}

/**
 * A real account does extra work (Redis writes, token mint) that an unknown one
 * skips — a ~25 ms difference that reveals whether an address is registered even
 * though the JSON is identical. Every outcome is padded to the same floor.
 */
const RESPONSE_FLOOR_MS = 250;

export async function requestPasswordReset(rawEmail: unknown, ip: string) {
  const started = Date.now();
  try {
    return await requestPasswordResetInner(rawEmail, ip);
  } finally {
    const remaining = RESPONSE_FLOOR_MS - (Date.now() - started);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  }
}

async function requestPasswordResetInner(rawEmail: unknown, ip: string) {
  if (typeof rawEmail !== "string" || !rawEmail.includes("@") || rawEmail.length > 254) return GENERIC;
  const email = rawEmail.trim().toLowerCase();

  // Budget is spent whether or not the account exists, so the limit itself leaks nothing.
  const okIp = await withinLimit(`pwd-reset:rl:ip:${ip}`, 10, 3600);
  const okEmail = await withinLimit(`pwd-reset:rl:email:${email}`, 3, 3600);
  if (!okIp || !okEmail) return GENERIC;

  const user = await db.user.findUnique({ where: { normalizedEmail: normalizeEmail(email) }, select: { id: true, email: true, role: true } });
  if (!user || NOT_SELF_SERVICE.includes(user.role)) return GENERIC;

  const token = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(token);

  const previous = await redis.get(userKey(user.id));
  if (previous) await redis.del(tokenKey(previous));
  await redis.set(tokenKey(hash), user.id, "EX", RESET_TTL_SECONDS);
  await redis.set(userKey(user.id), hash, "EX", RESET_TTL_SECONDS);

  const base = process.env.PASSWORD_RESET_URL ?? `${process.env.FRONTEND_URL ?? ""}/reset-password`;
  void sendPasswordResetEmail(user.email, `${base}?token=${token}`);
  return GENERIC;
}

export async function resetPassword(token: unknown, newPassword: unknown, ip: string) {
  if (!(await withinLimit(`pwd-reset:rl:redeem:${ip}`, 20, 3600))) {
    throw httpError(429, "Too many attempts. Try again later.");
  }
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw httpError(400, "Invalid or expired reset link");
  }
  assertStrongPassword(newPassword);

  // Atomic and single use: a second request with the same token gets null.
  const hash = hashToken(token);
  const userId = await redis.getdel(tokenKey(hash));
  if (!userId) throw httpError(400, "Invalid or expired reset link");
  await redis.del(userKey(userId));

  const { email } = await setUserPassword(userId, newPassword, ip);
  void sendPasswordChangedEmail(email, "password reset link");
  return { success: true, message: "Password updated. Please sign in with your new password." };
}


/**
 * Signed-in password change. Requires the current password (a stolen session alone must not be able
 * to take over the account), rate-limited per user, and ends every session on success — the caller
 * signs in again with the new password.
 */
export async function changePassword(userId: string, currentPassword: unknown, newPassword: unknown, ip: string) {
  if (!(await withinLimit(`pwd-change:rl:${userId}`, 10, 3600))) {
    throw httpError(429, "Too many attempts. Try again later.");
  }
  if (typeof currentPassword !== "string" || !currentPassword) throw httpError(400, "Enter your current password");
  assertStrongPassword(newPassword);
  if (newPassword === currentPassword) throw httpError(400, "Choose a password you haven't used just now");

  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true, email: true } });
  if (!user?.passwordHash || !(await comparePassword(currentPassword, user.passwordHash))) {
    throw httpError(400, "Your current password is incorrect");
  }
  const { email } = await setUserPassword(userId, newPassword, ip);
  void sendPasswordChangedEmail(email, "password change in settings");
  return { success: true, message: "Password updated. Please sign in again." };
}
