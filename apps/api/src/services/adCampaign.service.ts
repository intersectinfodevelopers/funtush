import { prisma } from "../packages/database/prisma";
import { queueEmail } from "../lib/emailQueue";
import { pushCampaignLive, pausePlatformCampaign } from "../lib/adPlatforms";

const LARGE_TIER = "LARGE" as const;

export class CampaignError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "CampaignError";
  }
}

const agencySummary = {
  id: true,
  name: true,
  tier: true,
  email: true,
} as const;

const pendingWhere = { status: "PENDING_APPROVAL", agency: { tier: { name: LARGE_TIER } } } as const;
export const countPendingCampaigns = () => prisma.adCampaign.count({ where: pendingWhere });
export const countActiveCampaigns = () => prisma.adCampaign.count({ where: { status: "ACTIVE" } });

export async function getPendingCampaigns(page?: { skip: number; take: number }) {
  return prisma.adCampaign.findMany({
    where: pendingWhere,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(page ?? {}),
    select: {
      id: true,
      status: true,
      imageUrls: true,
      copyText: true,
      targetingParams: true,
      dailyBudgetCents: true,
      createdAt: true,
      agency: { select: agencySummary },
    },
  });
}

export async function getActiveCampaigns(page?: { skip: number; take: number }) {
  return prisma.adCampaign.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ approvedAt: "desc" }, { id: "asc" }],
    ...(page ?? {}),
    select: {
      id: true,
      status: true,
      impressions: true,
      clicks: true,
      spend: true,
      metaCampaignId: true,
      googleCampaignId: true,
      googleSearchCampaignId: true,
      approvedAt: true,
      agency: { select: { id: true, name: true } },
    },
  });
}

export async function approveCampaign(id: string) {
  const campaign = await prisma.adCampaign.findUnique({
    where: { id },
    include: { agency: { select: agencySummary } },
  });

  if (!campaign) {
    throw new CampaignError(404, "Campaign not found");
  }

  if (campaign.status !== "PENDING_APPROVAL") {
    throw new CampaignError(
      409,
      `Campaign already ${campaign.status.toLowerCase()}`
    );
  }

  let ids: {
    metaCampaignId: string | null;
    googleCampaignId: string | null;
    googleSearchCampaignId: string | null;
  };

  try {
    ids = await pushCampaignLive({
      campaignId: campaign.id,
      imageUrls: campaign.imageUrls,
      copyText: campaign.copyText,
      targetingParams: campaign.targetingParams,
      dailyBudgetCents: campaign.dailyBudgetCents,
      agencyName: campaign.agency.name,
    });
  } catch (err) {
    throw new CampaignError(
      502,
      `Failed to push campaign live: ${err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const updated = await prisma.adCampaign.update({
    where: { id },
    data: {
      status: "ACTIVE",
      metaCampaignId: ids.metaCampaignId,
      googleCampaignId: ids.googleCampaignId,
      googleSearchCampaignId: ids.googleSearchCampaignId,
      approvedAt: new Date(),
    },
  });

  void queueEmail(
    campaign.agency.email,
    "Your ad campaign is live",
    "Good news — your campaign has been approved and is now running on Meta and Google."
  );

  return updated;
}

export async function rejectCampaign(id: string, reason: string) {
  if (!reason || !reason.trim()) {
    throw new CampaignError(400, "Rejection reason is required");
  }

  const campaign = await prisma.adCampaign.findUnique({
    where: { id },
    include: { agency: { select: agencySummary } },
  });
  if (!campaign) throw new CampaignError(404, "Campaign not found");
  if (campaign.status !== "PENDING_APPROVAL") {
    throw new CampaignError(409, `Campaign already ${campaign.status.toLowerCase()}`);
  }

  const updated = await prisma.adCampaign.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason: reason.trim(),
      rejectedAt: new Date(),
    },
  });

  void queueEmail(
    campaign.agency.email,
    "Your ad campaign was not approved",
    `Your campaign was rejected for the following reason:\n\n${reason.trim()}`
  );

  return updated;
}

export async function pauseCampaign(id: string) {
  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign) throw new CampaignError(404, "Campaign not found");
  if (campaign.status !== "ACTIVE") {
    throw new CampaignError(
      409,
      `Only active campaigns can be paused (current: ${campaign.status.toLowerCase()})`
    );
  }

  try {
    await pausePlatformCampaign({
      metaCampaignId: campaign.metaCampaignId ?? "",
      googleCampaignId: campaign.googleCampaignId ?? "",
      googleSearchCampaignId: campaign.googleSearchCampaignId ?? "",
    });
  } catch (err) {
    throw new CampaignError(
      502,
      `Failed to pause campaign on platform(s): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return prisma.adCampaign.update({
    where: { id },
    data: { status: "PAUSED", pausedAt: new Date() },
  });
}

export async function generateAdCampaign(agencyId: string) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    include: {
      packages: {
        where: { status: "PUBLISHED" },
        include: { itineraries: true },
      },
    },
  });

  if (!agency) throw new CampaignError(404, "Agency not found");
  if (!agency.packages?.length) {
    throw new CampaignError(400, "No published packages found");
  }

  const allPhotos = agency.packages.flatMap((pkg) =>
    pkg.itineraries?.flatMap((it) => it.photos ?? []) ?? []
  );

  if (allPhotos.length === 0) {
    throw new CampaignError(400, "No photos available for campaign creation");
  }

  const minPrice = Math.min(
    ...agency.packages.map((p) =>
      typeof p.pricePerPerson === 'number'
        ? p.pricePerPerson
        : p.pricePerPerson.toNumber?.() ?? Number(p.pricePerPerson)
    )
  );

  const creativeVariations = [
    {
      variant: 1,
      title: `Discover with ${agency.name}`,
      copyText: `Experience the thrill of adventure with ${agency.name}'s expert guides.`,
      imageUrls: allPhotos.slice(0, 3),
    },
    {
      variant: 2,
      title: `${agency.name} Treks`,
      copyText: `Affordable treks starting from $${minPrice} with ${agency.name}.`,
      imageUrls: allPhotos.slice(3, 6),
    },
    {
      variant: 3,
      title: `Expert Guided Treks`,
      copyText: `Join ${agency.packages.length}+ treks led by experts. Book your next adventure today.`,
      imageUrls: allPhotos.slice(6, 9),
    },
  ];

  return prisma.adCampaign.create({
    data: {
      agencyId,
      status: "PENDING_APPROVAL",
      imageUrls: allPhotos,
      copyText: creativeVariations.map((c) => c.copyText).join(" | "),
      targetingParams: {
        creativeVariations,
        packageIds: agency.packages.map((p) => p.id),
      },
    },
  });
}

export async function getCampaigns(agencyId: string) {
  return prisma.adCampaign.findMany({
    where: { agencyId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaign(id: string, agencyId: string) {
  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign) throw new CampaignError(404, "Campaign not found");
  if (campaign.agencyId !== agencyId) {
    throw new CampaignError(403, "Not authorized to access this campaign");
  }
  return campaign;
}