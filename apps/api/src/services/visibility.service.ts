import { prisma } from "@funtush/database";

// CONFIRMED via Prisma Studio (subscription_tiers.name): FREE, SMALL, MEDIUM, LARGE
type TierName = "FREE" | "SMALL" | "MEDIUM" | "LARGE";

const BASE_SCORE_BY_TIER: Record<TierName, number> = {
  LARGE: 100,
  MEDIUM: 50,
  SMALL: 25,
  FREE: 0,
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface VisibilityScoreInput {
  tierName: TierName;
  rating: number | null;
  hasRecentBooking: boolean;
  isProfileComplete: boolean;
  priorityOverride: number;
}

export interface VisibilityScoreResult {
  baseScore: number;
  qualityBonus: number;
  finalScore: number;
}

//  * Pure scoring function — no DB calls, no side effects.
//  * Exported separately so it can be unit tested in isolation

export function calculateVisibilityScore(
  input: VisibilityScoreInput
): VisibilityScoreResult {
  const baseScore = BASE_SCORE_BY_TIER[input.tierName];

  let qualityBonus = 0;
  if (input.rating !== null && input.rating >= 4.5) qualityBonus += 20;
  if (input.hasRecentBooking) qualityBonus += 5;
  if (input.isProfileComplete) qualityBonus += 10;

  const finalScore = baseScore + qualityBonus + input.priorityOverride;

  return { baseScore, qualityBonus, finalScore };
}

async function isProfileComplete(agencyId: string): Promise<boolean> {
  const profile = await prisma.agencyProfile.findUnique({
    where: { agencyId },
    select: { logo: true, description: true },
  });

  if (!profile || !profile.logo || !profile.description) return false;

  const publishedPackageCount = await prisma.trekPackage.count({
    where: { agencyId, status: "PUBLISHED" },
  });

  return publishedPackageCount > 0;
}


//  * Recalculates and persists visibility scores for every agency.
//  * Runs nightly via cron (see jobs/visibilityScore.job.ts) — not per-request,
//  * to keep marketplace search fast.
export async function recalculateAllVisibilityScores(): Promise<void> {
  const agencies = await prisma.agency.findMany({
    select: {
      id: true,
      priorityOverride: true,
      tier: { select: { name: true } },
    },
  });

  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);

  let successCount = 0;
  let failCount = 0;

  for (const agency of agencies) {
    try {
      const recentBooking = await prisma.booking.findFirst({
        where: {
          agencyId: agency.id,
          createdAt: { gte: sevenDaysAgo },
        },
        select: { id: true },
      });

      // Live aggregation — acceptable here since this only runs nightly,
      // never on the hot marketplace search path.
      const reviewAgg = await prisma.review.aggregate({
        where: { agencyId: agency.id },
        _avg: { rating: true },
      });
      const rating = reviewAgg._avg.rating;

      const profileComplete = await isProfileComplete(agency.id);

      const result = calculateVisibilityScore({
        tierName: agency.tier.name as TierName,
        rating,
        hasRecentBooking: Boolean(recentBooking),
        isProfileComplete: profileComplete,
        priorityOverride: agency.priorityOverride,
      });

      await prisma.agencyVisibilityScore.upsert({
        where: { agencyId: agency.id },
        create: {
          agencyId: agency.id,
          baseScore: result.baseScore,
          qualityBonus: result.qualityBonus,
          finalScore: result.finalScore,
        },
        update: {
          baseScore: result.baseScore,
          qualityBonus: result.qualityBonus,
          finalScore: result.finalScore,
          calculatedAt: new Date(),
        },
      });

      successCount++;
    } catch (err) {
      failCount++;
      console.error(`[VisibilityService] Failed to score agency ${agency.id}:`, err);
      // Intentionally continue — one bad agency shouldn't block the whole batch
    }
  }

  console.log(
    `[VisibilityService] Recalculation complete. Success: ${successCount}, Failed: ${failCount}`
  );
}