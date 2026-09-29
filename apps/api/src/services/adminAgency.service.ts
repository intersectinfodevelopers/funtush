import { prisma } from "@funtush/database";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { jwtPayload } from "@funtush/auth";
import { cacheSet, cacheDel } from "./redis.service";
import { calculateAndPersistVisibilityScore } from "./visibility.service";
import { reindexAgencyPackages } from "./search.service";

// One active impersonation session per agency, tracked here so it can be
// revoked before its natural expiry — checked by
// middleware/refreshTokenAuthentication.ts and middleware/
// checkImpersonationActive.middleware.ts on every request a token with
// `impersonatedBy` makes. Starting a new session for an agency overwrites
// this key, so only the most recent session is ever valid — a deliberate
// single-active-session model, not a bug.
export const IMPERSONATION_ACTIVE_PREFIX = "impersonation-active:";


export interface AgencyListFilter {
  tier?:       string;  
  status?:     string;  
  search?:     string;
  joinedFrom?: string;  
  joinedTo?:   string;
  page?:       number;
  limit?:      number;
}

export async function listAgencies(filters: AgencyListFilter) {
  const page  = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const skip  = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.tier)   where.tier   = { name: filters.tier };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    where.OR = [
      { name:  { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  if (filters.joinedFrom || filters.joinedTo) {
    const createdAt: Record<string, Date> = {};
    if (filters.joinedFrom) createdAt.gte = new Date(`${filters.joinedFrom}T00:00:00.000Z`);
    if (filters.joinedTo)   createdAt.lte = new Date(`${filters.joinedTo}T23:59:59.999Z`);
    where.createdAt = createdAt;
  }

  const [total, agencies] = await Promise.all([
    prisma.agency.count({ where }),
    prisma.agency.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true,
        tier: { select: { name: true } },
        status: true, createdAt: true, slug: true,
      },
    }),
  ]);

  return {
    data: agencies,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

// Full agency profile 
export async function getAgencyProfile(id: string) {
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
      subscriptions: true,
      _count: { select: { bookings: true, users: true } }, // FIX: relation is `users`, not `agencyUsers`
    },
  });
  if (!agency) return null;

  const [bookingSummary, kyc] = await Promise.all([
    prisma.booking.aggregate({
      _count: { _all: true },
      _sum:   { totalPrice: true }, // FIX: field is `totalPrice`, not `totalAmount`
      where:  { agencyId: id },
    }),
    prisma.kycSubmission.findUnique({
      where:  { agencyId: id },
      select: { status: true, submittedAt: true, reviewedAt: true },
    }),
  ]);

  return {
    ...agency,
    staffCount:    (agency as unknown as { _count: { users: number } })._count.users,
    bookingCount:  bookingSummary._count._all,
    bookingSummary: {
      totalBookings: bookingSummary._count._all,
      totalRevenue:  bookingSummary._sum.totalPrice ?? 0,
    },
    kycStatus: kyc?.status ?? "NONE",
  };
}

// Change tier (immediate)
export async function updateAgencyTier(id: string, tierName: string) {

  const tier = await prisma.subscriptionTier.findUnique({
    where: { name: tierName },
    select: { id: true },
  });
  if (!tier) throw new Error(`Unknown tier: ${tierName}`);

  const updated = await prisma.agency.update({
    where: { id },
    data:  { tierId: tier.id },
    select: { id: true, tier: { select: { name: true } } },
  });

  // A tier change moves the agency's visibility/marketplaceWeight/adsEnabled
  // standing immediately — the search index must reflect that now, not at the
  // next scheduled full reindex.
  await reindexAgencyPackages(id).catch((err) => {
    console.error(`[updateAgencyTier] Failed to reindex agency ${id} after tier change:`, err);
  });

  return updated;
}

// Change status
//
// `statusReason`/`statusUpdatedAt` were never columns on `Agency` — this
// previously 500'd on every call. The route already requires and records the
// reason via `writeAuditLog` (see `agencyManagement.route.ts`'s
// `AGENCY_STATUS_CHANGED` entry), which is this change's real system of
// record, matching how every other admin mutation in this file works; only
// the ban path (`fraud.service.ts confirmFraud`) stores its reason directly
// on `Agency` (`banReason`), because that one is read back later by the ban
// registry, not just logged.
export async function updateAgencyStatus(
  id: string,
  status: "ACTIVE" | "SUSPENDED" | "LOCKED"
) {
  return prisma.agency.update({
    where: { id },
    data: { status },
    select: { id: true, status: true },
  });
}

const IMPERSONATE_TTL_SECONDS = 60 * 60; // 1 hour — a real working session, still time-boxed

/**
 * Issues a real, working agency session for support/admin purposes — not an
 * opaque token (the previous `issueImpersonationToken` minted a
 * `crypto.randomBytes` string and cached it under `impersonate:${token}`,
 * but nothing anywhere ever read that cache key back: there was no exchange
 * endpoint, no middleware checking it, nothing. The "impersonation" feature
 * was a stub that could never actually grant access to anything).
 *
 * `authenticateWithRefreshToken` (the middleware gating every agency-
 * dashboard route) does not trust `agencyId` from the JWT at all — it
 * verifies the JWT's `userId` and re-derives the agency by looking up a
 * real `AgencyUser` row for that user. So a working impersonation session
 * has to be a real refresh token for a real `AgencyUser`, not a synthetic
 * claim — there is no lighter-weight way to reach the same routes the
 * agency's own dashboard uses.
 *
 * The admin becomes the agency's own primary AGENCY_ADMIN user for the
 * session (the earliest-created AGENCY_ADMIN AgencyUser — the account's
 * real owner, not a later-added staff member), the same identity that
 * agencyLogin() would authenticate. Deliberately NOT persisted to
 * `prisma.refreshToken`: `authenticateWithRefreshToken` never checks that
 * table (only the JWT's own signature/expiry), so skipping the row means
 * `POST /auth/refresh` — which does require a matching DB row — simply
 * can't extend this token past its 1-hour expiry into a normal 7-day
 * session. The window is real, not just advisory.
 */
export async function impersonateAgency(agencyId: string, adminId: string) {
  const agency = await prisma.agency.findUnique({
    where:  { id: agencyId },
    select: { id: true, name: true, email: true, status: true },
  });
  if (!agency) throw new Error("Agency not found");
  if (agency.status === "BANNED") throw new Error("Cannot impersonate a banned agency");

  const owner = await prisma.agencyUser.findFirst({
    where:   { agencyId, role: "AGENCY_ADMIN" },
    orderBy: { joinedAt: "asc" },
    select:  { user: { select: { id: true, email: true } } },
  });
  if (!owner) throw new Error("Agency has no AGENCY_ADMIN user to impersonate");

  // Identifies the session itself, independent of who it's acting as —
  // carried in both tokens so every request made with them can be traced
  // back to (a) who's really driving it (impersonatedBy) and (b) which
  // session, so a revoke or a stale/replaced session can be told apart
  // from the current one (impersonationSessionId).
  const sessionId = crypto.randomUUID();

  const payload: jwtPayload = {
    userId: owner.user.id,
    roleType: "TENANT",
    role: "AGENCY_ADMIN",
    agencyId,
    impersonatedBy: adminId,
    impersonationSessionId: sessionId,
  };
  // A support session cannot use /auth/refresh, so the access token must outlive the working session.
  // That is safe here: every request with it is checked against the active-session pointer below,
  // so a revoke (or a newer session) kills it at once.
  const accessToken  = jwt.sign(payload, process.env.JWT_ACCESS_SECRET as string, { expiresIn: `${IMPERSONATE_TTL_SECONDS}s` });
  const refreshToken = jwt.sign(
    { userId: owner.user.id, impersonatedBy: adminId, impersonationSessionId: sessionId },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: `${IMPERSONATE_TTL_SECONDS}s` },
  );
  const expiresAt = new Date(Date.now() + IMPERSONATE_TTL_SECONDS * 1000);

  // The actual revocation record — checked on every request a token with
  // `impersonatedBy` makes (see checkImpersonationActive.middleware.ts and
  // authenticateWithRefreshToken). Starting a new session for this agency
  // overwrites this key, which is what makes the old session's tokens stop
  // working immediately even though they're still cryptographically valid.
  await cacheSet(`${IMPERSONATION_ACTIVE_PREFIX}${agencyId}`, { sessionId, adminId }, IMPERSONATE_TTL_SECONDS);

  return {
    accessToken,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
    ttlSeconds: IMPERSONATE_TTL_SECONDS,
    agencyId,
    agencyName: agency.name,
    impersonatedUserId: owner.user.id,
    impersonatedEmail: owner.user.email,
    sessionId,
  };
}

/**
 * Ends the agency's active impersonation session before its natural
 * expiry. Since the session is stateless JWTs (not DB rows), "revoke"
 * means removing the pointer that `checkImpersonationActive` /
 * `authenticateWithRefreshToken` look up on every request a token with
 * `impersonatedBy` makes — once it's gone, those tokens still decode fine
 * but every request they make 401s.
 */
export async function revokeImpersonation(agencyId: string): Promise<void> {
  await cacheDel(`${IMPERSONATION_ACTIVE_PREFIX}${agencyId}`);
}

export interface PriorityOverrideResult {
  agencyId: string;
  priorityOverride: number;
  finalScore: number;
  sponsored: boolean;
}

export async function updateAgencyPriorityOverride(
  agencyId: string,
  priorityOverride: number
): Promise<PriorityOverrideResult> {
  if (!Number.isInteger(priorityOverride) || priorityOverride < 0) {
    throw new Error("priorityOverride must be a non-negative integer");
  }

  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { id: true },
  });
  if (!agency) throw new Error("Agency not found");

  await prisma.agency.update({
    where: { id: agencyId },
    data: { priorityOverride },
  });

  // Recompute base + quality + NEW override, persist immediately.
  const scoreResult = await calculateAndPersistVisibilityScore(agencyId);

  await reindexAgencyPackages(agencyId);

  return {
    agencyId,
    priorityOverride,
    finalScore: scoreResult.finalScore,
    sponsored: priorityOverride > 0,
  };
}