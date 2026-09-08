// ─────────────────────────────────────────────────────────────────────────────
// End-to-end test helpers.
//
// These tests drive the *real* consolidated Express app (src/app.ts) over HTTP
// via supertest, against the real docker-compose.test.yml infra. They mint the
// two credential shapes the app accepts:
//
//   - x-refresh-token  → authenticateWithRefreshToken. A JWT signed with
//                        JWT_REFRESH_SECRET carrying { userId, role, roleType };
//                        the middleware verifies it and resolves the AgencyUser.
//   - Authorization: Bearer <jwt> → @funtush/auth requireAuth + requireRole
//                        (bookings, staff). A signed access token with
//                        role = AGENCY_ADMIN and the agencyId claim.
//
// Everything is created under a throwaway agency and torn down afterwards.
// If the DB is unreachable the caller should skip (see `dbAvailable`).
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { db, connectMongo } from "@funtush/database";
import { generateAccessToken } from "@funtush/auth";

/**
 * True when the full docker-compose.test.yml stack is reachable. E2E tests drive
 * the real app end-to-end, so they need both Postgres (Prisma) and Mongo — the
 * staff/safety paths write to the Mongo-backed AuditLog / SOS collections, and
 * app.ts (unlike index.ts) never opens the Mongo connection itself.
 */
export async function dbAvailable(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    await connectMongo();
    return true;
  } catch {
    return false;
  }
}

export interface E2EContext {
  agencyId: string;
  userId: string;
  tierId: string;
  /** JWT — send as the `x-refresh-token` header */
  refreshToken: string;
  /** signed access token — send as `Authorization: Bearer <token>` */
  accessToken: string;
  cleanup: () => Promise<void>;
}

export interface E2EOptions {
  tierName?: string;
  maxGuides?: number;
  maxStaff?: number;
  maxPackages?: number;
  agencyStatus?: "TRIAL" | "ACTIVE" | "LOCKED" | "SUSPENDED" | "BANNED";
}

/** Spin up a throwaway agency + admin user + both credential shapes. */
export async function createAgencyContext(opts: E2EOptions = {}): Promise<E2EContext> {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tierName = opts.tierName ?? `E2E_TIER_${suffix}`;

  const tier = await db.subscriptionTier.upsert({
    where: { name: tierName },
    update: {
      maxGuides: opts.maxGuides ?? 25,
      maxStaff: opts.maxStaff ?? 25,
      maxPackages: opts.maxPackages ?? 50,
    },
    create: {
      name: tierName,
      maxStaff: opts.maxStaff ?? 25,
      maxGuides: opts.maxGuides ?? 25,
      maxPackages: opts.maxPackages ?? 50,
      monthlyPrice: 0,
      features: {},
    },
    select: { id: true },
  });

  const agency = await db.agency.create({
    data: {
      name: `E2E Agency ${suffix}`,
      email: `e2e-${suffix}@example.com`,
      slug: `e2e-${suffix}`,
      tierId: tier.id,
      status: opts.agencyStatus ?? "ACTIVE",
    },
    select: { id: true },
  });

  const user = await db.user.create({
    data: {
      email: `e2e-admin-${suffix}@example.com`,
      passwordHash: "x", // never used — tests present tokens directly
      role: "AGENCY_ADMIN",
      roleType: "TENANT",
    },
    select: { id: true },
  });

  await db.agencyUser.create({
    data: { agencyId: agency.id, userId: user.id, role: "AGENCY_ADMIN" },
  });

  // authenticateWithRefreshToken verifies this as a JWT (JWT_REFRESH_SECRET) and
  // resolves the AgencyUser by `userId`.
  const refreshToken = jwt.sign(
    { userId: user.id, role: "AGENCY_ADMIN", roleType: "TENANT" },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: "1h" },
  );

  const accessToken = generateAccessToken({
    userId: user.id,
    roleType: "TENANT",
    role: "AGENCY_ADMIN",
    agencyId: agency.id,
  } as Parameters<typeof generateAccessToken>[0]);

  const cleanup = async () => {
    // FK cascades from Agency handle bookings/guides/etc.
    await db.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    await db.subscriptionTier.delete({ where: { id: tier.id } }).catch(() => {});
  };

  return {
    agencyId: agency.id,
    userId: user.id,
    tierId: tier.id,
    refreshToken,
    accessToken,
    cleanup,
  };
}

/** A published package + one future departure + one add-on, owned by `agencyId`. */
export async function seedPackage(
  agencyId: string,
  overrides: { maxSlots?: number; pricePerPerson?: number } = {},
): Promise<{
  packageId: string;
  departureDateId: string;
  departureStart: Date;
  addOnId: string;
}> {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  const pkg = await db.trekPackage.create({
    data: {
      agencyId,
      title: `E2E Trek ${suffix}`,
      slug: `e2e-trek-${suffix}`,
      durationDays: 10,
      pricePerPerson: overrides.pricePerPerson ?? 1200,
      difficulty: "MODERATE",
      maxGroupSize: 12,
      status: "PUBLISHED",
    },
    select: { id: true },
  });

  const departureStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const departure = await db.trekDepartureDate.create({
    data: {
      packageId: pkg.id,
      startDate: departureStart,
      maxSlots: overrides.maxSlots ?? 10,
      bookedSlots: 0,
      status: "AVAILABLE",
    },
    select: { id: true },
  });

  const addOn = await db.trekAddOn.create({
    data: { packageId: pkg.id, name: "Porter", price: 200, perPerson: true },
    select: { id: true },
  });

  return {
    packageId: pkg.id,
    departureDateId: departure.id,
    departureStart,
    addOnId: addOn.id,
  };
}
