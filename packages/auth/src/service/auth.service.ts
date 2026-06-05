import { comparePassword } from "../password";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../jwt";
import { hashToken } from "../utils/hashToken";
import { prisma } from "@funtush/database";

function expiry(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// PLATFORM ADMIN LOGIN
export async function adminLogin(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.role !== "SUPER_ADMIN") {
    throw new Error("Invalid credentials");
  }

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "platform",
    role: "super_admin",
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
  const user = await prisma.user.findUnique({
    where: { email },
    include: { agency: true },
  });

  if (!user || user.role !== "AGENCY_ADMIN") {
    throw new Error("Invalid credentials");
  }

  if (!user.agency) throw new Error("Agency not found");

  if (["LOCKED", "SUSPENDED"].includes(user.agency.status)) {
    throw new Error("Agency blocked");
  }

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "tenant",
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
  const user = await prisma.user.findUnique({
    where: { email },
    include: { trekker: true },
  });

  if (!user || !user.trekker) {
    throw new Error("Invalid credentials");
  }

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "trekker",
    role: "trekker",
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