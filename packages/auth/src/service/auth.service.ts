import { comparePassword } from "../password.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../jwt.js";
import {
  isLocked,
  registerFailedAttempt,
  resetAttempts,
} from "../utils/lockout.js";
import { hashToken } from "../utils/hashToken.js";
import { prisma } from "@funtush/database";
import { jwtPayload } from "../types.js";
import { redis } from "../utils/redis.js";
import { checkOtpRateLimit } from "../utils/otpRateLimit.js";

function expiry(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// PLATFORM ADMIN LOGIN
export async function adminLogin(email: string, password: string) {
  email = email.toLowerCase().trim();

  if (await isLocked(email)) {
    throw new Error(
      "Your account has been temporarily blocked due to too many unsuccessful attempts. Please try again after 15 minutes."
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.role !== "SUPER_ADMIN") {
    await registerFailedAttempt(email);
    throw new Error("Invalid credentials");
  }

  const ok = await comparePassword(password, user.passwordHash);

  if (!ok) {
    await registerFailedAttempt(email);
    throw new Error("Invalid credentials");
  }

  await resetAttempts(email);

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "PLATFORM",
    role: "SUPER_ADMIN",
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
export async function agencyLogin(email: string, password: string) {
  email = email.toLowerCase().trim();

  if (await isLocked(email)) {
    throw new Error(
      "Your account has been temporarily blocked due to too many unsuccessful attempts. Please try again after 15 minutes."
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { agency: true },
  });

  if (!user || user.role !== "AGENCY_ADMIN") {
    await registerFailedAttempt(email);
    throw new Error("Invalid credentials");
  }

  if (!user.agency) {
    await registerFailedAttempt(email);
    throw new Error("Invalid credentials");
  }

  if (["LOCKED", "SUSPENDED"].includes(user.agency.status)) {
    throw new Error("Agency blocked");
  }

  const ok = await comparePassword(password, user.passwordHash);

  if (!ok) {
    await registerFailedAttempt(email);
    throw new Error("Invalid credentials");
  }

  await resetAttempts(email);

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "TENANT",
    role: user.role,
    agencyId: user.agency.id,
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
export async function trekkerLogin(email: string, password: string) {
  email = email.toLowerCase().trim();

  if (await isLocked(email)) {
    throw new Error(
      "Your account has been temporarily blocked due to too many unsuccessful attempts. Please try again after 15 minutes."
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { trekker: true },
  });

  if (!user || !user.trekker) {
    await registerFailedAttempt(email);
    throw new Error("Invalid credentials");
  }

  const ok = await comparePassword(password, user.passwordHash);

  if (!ok) {
    await registerFailedAttempt(email);
    throw new Error("Invalid credentials");
  }

  await resetAttempts(email);

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

  // get user
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.roleType) {
    throw new Error("Invalid user");
  }

  // create new tokens
  const newAccessToken = generateAccessToken({
    userId: user.id,
    roleType: user.roleType,
    role: user.role,
    agencyId: user.agencyId ?? undefined,
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

  return { success: true };
}

export async function resendOtpService(email: string) {
  email = email.toLowerCase().trim();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const limit = await checkOtpRateLimit(email);

  if (!limit.allowed) {
    throw new Error(
      `Too many OTP requests. Try again after ${limit.retryAfter} seconds.`
    );
  }

  // generate OTP + store in Redis 
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // store OTP
  await redis.set(`otp:${email}`, otp, "EX", 15 * 60);

  // send OTP 
  console.log("OTP sent:", otp);

  return {
    success: true,
    remainingAttempts: limit.remaining,
  };
}