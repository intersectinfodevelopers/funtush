import { normalizeEmail } from "@funtush/shared";
import { comparePassword, hashPassword } from "../password";
import { revokeRefreshToken } from "../utils/tokenRevocation";
import { generateOTP } from "../otp";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../jwt";
import {
  isLocked,
  registerFailedAttempt,
  resetAttempts,
} from "../utils/lockout";
import { hashToken } from "../utils/hashToken";
import { db, prisma } from "@funtush/database";
import { jwtPayload, type Role } from "../types";
import { redis } from "../utils/redis";
import { checkOtpRateLimit } from "../utils/otpRateLimit";

// Compared against when the email doesn't exist, so an unknown account costs the
// same bcrypt time as a real one. Otherwise response time (~1ms vs ~100ms) tells
// an attacker exactly which emails are registered.
let dummyHashPromise: Promise<string> | undefined;
async function burnPasswordCompare(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword("timing-equalisation-not-a-real-password");
  await comparePassword(password, await dummyHashPromise);
}

function expiry(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

const PLATFORM_LOGIN_ROLES = ["SUPER_ADMIN", "PLATFORM_ADMIN", "PLATFORM_SUPPORT"] as const;

// PLATFORM ADMIN LOGIN
export async function adminLogin(email: string, password: string, ip?: string) {
  email = email.toLowerCase().trim();

  if (await isLocked(email, ip)) {
    throw new Error(
      "Your account has been temporarily blocked due to too many unsuccessful attempts. Please try again after 15 minutes."
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Previously hard-coded to SUPER_ADMIN only, so a PLATFORM_ADMIN or
  // PLATFORM_SUPPORT account created via the Team feature could never sign
  // in at all — this widens the check to any real platform role.
  const validRole =
    user?.roleType === "PLATFORM" &&
    (PLATFORM_LOGIN_ROLES as readonly string[]).includes(user.role);

  if (!user || !validRole) {
    await burnPasswordCompare(password);
    await registerFailedAttempt(email, ip);
    throw new Error("Invalid credentials");
  }

  const ok = await comparePassword(password, user.passwordHash);

  // Password checked before account-state — same reasoning as agencyLogin
  // just below: a single generic error means a deactivated account's state
  // isn't distinguishable from a wrong password to someone without it.
  if (!ok || !user.isActive) {
    await registerFailedAttempt(email, ip);
    throw new Error("Invalid credentials");
  }

  await resetAttempts(email, ip);

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "PLATFORM",
    // Previously hard-coded to "SUPER_ADMIN" regardless of the account's
    // real role — every platform login carried full admin power in the JWT.
    role: user.role as Role,
  });

  const refreshToken = generateRefreshToken(user.id);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: expiry(7),
    },
  });

  return { accessToken, refreshToken };
}

// AGENCY LOGIN
export async function agencyLogin(email: string, password: string, ip?: string) {
  email = email.toLowerCase().trim();

  if (await isLocked(email, ip)) {
    throw new Error(
      "Your account has been temporarily blocked due to too many unsuccessful attempts. Please try again after 15 minutes."
    );
  }

  const user = await db.user.findUnique({
    where: { email },
    include: {
      agencyUsers: {
        include: {
          agency: true,
          // Invited staff sign in too; their membership row says whether they are still active.
          agencyStaffs: { select: { isActive: true } },
        }
      },
      trekker: true,
      refreshTokens: true,
    }
  });

  if (!user || (user.role !== "AGENCY_ADMIN" && user.role !== "STAFF")) {
    await burnPasswordCompare(password);
    await registerFailedAttempt(email, ip);
    throw new Error("Invalid credentials");
  }

  const membership = user.agencyUsers[0];
  const agency = membership?.agency;
  // A STAFF account works only while its staff record exists and is active (deactivating a member blocks login).
  const staffOk = user.role === "AGENCY_ADMIN" || Boolean(membership?.agencyStaffs.some((s) => s.isActive));

  // Password FIRST, account state after. Reporting "Agency blocked" before the
  // password was checked told anyone who merely knew an email address that the
  // account exists and is suspended.
  const ok = await comparePassword(password, user.passwordHash);

  if (!agency || !ok || !staffOk) {
    await registerFailedAttempt(email, ip);
    throw new Error("Invalid credentials");
  }

  if (["LOCKED", "SUSPENDED"].includes(agency.status)) {
    throw new Error("Agency blocked");
  }

  await resetAttempts(email, ip);

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "TENANT",
    role: user.role,
    agencyId: agency.id,
  });

  const refreshToken = generateRefreshToken(user.id);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: expiry(7),
    },
  });

  return { accessToken, refreshToken };
}

// trekker login
export async function trekkerLogin(email: string, password: string, ip?: string) {
  email = email.toLowerCase().trim();

  if (await isLocked(email, ip)) {
    throw new Error(
      "Your account has been temporarily blocked due to too many unsuccessful attempts. Please try again after 15 minutes."
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { trekker: true },
  });

  if (!user || !user.trekker) {
    await burnPasswordCompare(password);
    await registerFailedAttempt(email, ip);
    throw new Error("Invalid credentials");
  }

  const ok = await comparePassword(password, user.passwordHash);

  if (!ok) {
    await registerFailedAttempt(email, ip);
    throw new Error("Invalid credentials");
  }

  await resetAttempts(email, ip);

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "TREKKER",
    role: "TREKKER",
  });

  const refreshToken = generateRefreshToken(user.id);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: expiry(7),
    },
  });

  return { accessToken, refreshToken };
}

// for /auth/me - get current user info
export function getMe(user: jwtPayload) {
  return {
    userId: user.userId,
    role: user.role,
    roleType: user.roleType,
    agencyId: user.agencyId ?? null,
    permissions: user.permissions ?? [],
  };
}

// refresh token
export async function refreshTokenService(refreshToken: string) {
  // verify JWT
  const decoded = verifyRefreshToken(refreshToken);

  const userId = decoded.userId;

  // hash incoming token
  const tokenHash = hashToken(refreshToken);

  // check DB
  const deleted = await prisma.refreshToken.deleteMany({
    where: {
      userId,
      tokenHash,
    },
  });

  if (deleted.count === 0) {
    throw new Error("Invalid refresh token");
  }

  // The rotated-out token must stop working everywhere, not just at /auth/refresh
  await revokeRefreshToken(refreshToken);

  // get user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      agencyUsers: {
        include: { agency: true }
      }
    }
  });

  if (!user || !user.roleType) {
    throw new Error("Invalid user");
  }

  // create new tokens
  const agencyId = user.agencyUsers?.[0]?.agencyId ?? undefined;

  const newAccessToken = generateAccessToken({
    userId: user.id,
    roleType: user.roleType,
    role: user.role as Role,
    agencyId,
  });

  const newRefreshToken = generateRefreshToken(user.id);

  // store new refresh token
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(newRefreshToken),
      expiresAt: expiry(7),
    },
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

// logout - delete refresh token from DB
export async function logoutService(refreshToken: string) {
  if (!refreshToken) {
    throw new Error("Refresh token required");
  }

  const tokenHash = hashToken(refreshToken);
  const decoded = verifyRefreshToken(refreshToken);

  await prisma.refreshToken.deleteMany({
    where: {
      userId: decoded.userId,
      tokenHash,
    },
  });

  // ...and stop it being usable directly as an x-refresh-token credential
  await revokeRefreshToken(refreshToken);

  return { success: true };
}

/**
 * `deliver` sends the code (the API passes its email sender). It is injected because this package has no mail
 * transport of its own; without it the code is only logged in development, as before. A delivery failure never
 * changes the response, so this endpoint still can't reveal which addresses are registered.
 */
export async function resendOtpService(rawEmail: unknown, deliver?: (email: string, otp: string) => Promise<void>) {
  // Same response whether or not the account exists (and for junk input), so this
  // endpoint can't be used to test which emails are registered. The rate limit is
  // charged BEFORE the lookup and keyed by the email string, so unknown addresses
  // are throttled identically to real ones.
  const generic = { success: true, message: "If that account exists, a code has been sent." };
  if (typeof rawEmail !== "string" || !rawEmail.includes("@") || rawEmail.length > 254) return generic;
  const email = rawEmail.toLowerCase().trim();

  const limit = await checkOtpRateLimit(email);
  if (!limit.allowed) {
    throw new Error(`Too many OTP requests. Try again after ${limit.retryAfter} seconds.`);
  }

  const user = await prisma.user.findUnique({ where: { normalizedEmail: normalizeEmail(email) }, select: { id: true } });
  if (!user) return generic;

  // crypto.randomInt — Math.random() is a predictable PRNG, so an attacker who
  // sees a few codes can compute the next ones.
  const otp = generateOTP();
  await redis.set(`otp:${email}`, otp, "EX", 15 * 60);
  await redis.del(`otp-attempts:${email}`);

  // Never write a live one-time code to the logs outside local development.
  if (process.env.NODE_ENV !== "production") console.log("OTP (dev only):", otp);

  if (deliver) {
    try {
      await deliver(email, otp);
    } catch (err) {
      console.error("[otp] delivery failed:", (err as Error).message);
    }
  }

  return generic;
}
