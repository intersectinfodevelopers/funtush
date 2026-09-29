import { prisma } from "../packages/database/prisma.js";
import { cacheGet, cacheSet } from "./redis.service.js";
import crypto from "crypto";

const DASHBOARD_TTL = 60;


const AGENCY_STATUSES = ["TRIAL", "ACTIVE", "LOCKED", "SUSPENDED", "BANNED"] as const;
const KYC_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;

/**
 * The platform-overview landing page's numbers — deliberately lifecycle/KYC
 * counts, not revenue or bookings (those live on the dedicated Analytics
 * page). "Paid" here means "on any tier other than FREE," independent of
 * status — an agency can be SUSPENDED and still be on a paid tier.
 */
export async function getDashboardStats() {
  const cacheKey = "admin:dashboard";
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const now = new Date();

  const [tiersWithAgencyCounts, statusCounts, kycCounts, agenciesWithoutKyc, totalAgencies] =
    await Promise.all([
      // `Agency.tier` is a relation (`tierId` is the scalar FK), so the
      // breakdown is built from the tier side rather than a `groupBy` on a
      // non-scalar field.
      prisma.subscriptionTier.findMany({
        select: { name: true, _count: { select: { agencies: true } } },
      }),

      prisma.agency.groupBy({ by: ["status"], _count: { _all: true } }),

      prisma.kycSubmission.groupBy({ by: ["status"], _count: { _all: true } }),

      // No KycSubmission row at all is the implicit "hasn't started KYC"
      // state — never assumed to be REJECTED or any other real status.
      prisma.agency.count({ where: { kyc: null } }),

      prisma.agency.count(),
    ]);

  const agenciesByTier = tiersWithAgencyCounts.reduce((acc: Record<string, number>, row) => {
    acc[row.name] = row._count.agencies;
    return acc;
  }, {} as Record<string, number>);

  const agenciesByStatus = Object.fromEntries(AGENCY_STATUSES.map((s) => [s, 0])) as Record<(typeof AGENCY_STATUSES)[number], number>;
  for (const row of statusCounts) agenciesByStatus[row.status] = row._count._all;

  const kycByStatus = Object.fromEntries(KYC_STATUSES.map((s) => [s, 0])) as Record<(typeof KYC_STATUSES)[number], number>;
  for (const row of kycCounts) kycByStatus[row.status] = row._count._all;

  const stats = {
    totalAgencies,
    agenciesOnTrial: agenciesByStatus.TRIAL,
    agenciesOnPaidPlan: totalAgencies - (agenciesByTier["FREE"] ?? 0),
    kycVerified: kycByStatus.APPROVED,
    agenciesByTier,
    agenciesByStatus,
    kycByStatus: { ...kycByStatus, NOT_SUBMITTED: agenciesWithoutKyc },
    generatedAt: now.toISOString(),
  };

  await cacheSet(cacheKey, stats, DASHBOARD_TTL);
  return stats;
}


// (agency list/profile/tier/status live in adminAgency.service.ts — the copies
// that used to sit here were unused and referenced fields/models that don't exist.)

// SUPERSEDED — dead code (this file is not compiled; see tsconfig excludes). The real,
// working break-glass flow is services/breakGlass.service.ts.
const BREAK_GLASS_TTL_SECONDS = 30 * 60;

export async function issueBreakGlassToken(agencyId: string, issuedByIp: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + BREAK_GLASS_TTL_SECONDS * 1000);


  const record = await prisma.breakGlassToken.create({
    data: {
      token,
      agencyId,
      issuedByIp,
      expiresAt,
    },
  });


  await cacheSet(`break-glass:${token}`, { agencyId, issuedByIp }, BREAK_GLASS_TTL_SECONDS);


  notifyAgencyAdminOfBreakGlass(agencyId, expiresAt).catch((err) =>
    console.error("[break-glass] notification failed:", err)
  );

  return { token, expiresAt, recordId: record.id };
}



async function notifyAgencyAdminOfBreakGlass(agencyId: string, expiresAt: Date) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { email: true, name: true },
  });
  if (!agency) return;

  console.log(
    `[break-glass] NOTIFY ${agency.email}: Emergency access granted to ${agency.name} — expires ${expiresAt.toISOString()}`
  );
}


