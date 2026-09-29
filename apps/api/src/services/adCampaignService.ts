import { prisma } from "../packages/database/prisma";
import { queueEmail } from "../lib/emailQueue";
import { pushCampaignLive, pausePlatformCampaign } from "../lib/adPlatforms";

const LARGE_TIER = "LARGE" as const;

// Thrown by the service; the route maps `.status` onto the HTTP response. */
export class CampaignError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "CampaignError";
  }
}

// `email` here is the agency's contact address — rename if your Agency model
// uses a different field (e.g. contactEmail, ownerEmail).
const agencySummary = {
  id: true,
  name: true,
  tier: true,
  email: true,
} as const;

// All campaigns awaiting Super Admin review, oldest first (FIFO review).
export async function getPendingCampaigns() {
  return prisma.adCampaign.findMany({
    where: { status: "PENDING_APPROVAL", agency: { tier: { name: LARGE_TIER } } },
    orderBy: { createdAt: "asc" },
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

// All ACTIVE campaigns with their stored delivery metrics. */
export async function getActiveCampaigns() {
  // Returns the metrics persisted on each row. To show real-time numbers,
  // run a periodic sync job that calls fetchCampaignMetrics() from adPlatforms
  // and writes the results back here, rather than hitting the platforms on
  // every dashboard load.
  return prisma.adCampaign.findMany({
    where: { status: "ACTIVE" },
    orderBy: { approvedAt: "desc" },
    select: {
      id: true,
      status: true,
      impressions: true,
      clicks: true,
      spend: true,
      metaCampaignId: true,
      googleCampaignId: true,
      approvedAt: true,
      agency: { select: { id: true, name: true } },
    },
  });
}

// Approve a campaign awaiting review: push it live, mark ACTIVE, notify the agency. */
export async function approveCampaign(id: string) {
  const campaign = await prisma.adCampaign.findUnique({
    where: { id },
    include: { agency: { select: agencySummary } },
  });
  if (!campaign) throw new CampaignError(404, "Campaign not found");
  if (campaign.status !== "PENDING_APPROVAL") {
    throw new CampaignError(409, `Campaign already ${campaign.status.toLowerCase()}`);
  }

  // Push live on Meta + Google BEFORE marking active, so a failed push leaves
  // the campaign PENDING_APPROVAL rather than ACTIVE-but-not-running.
  const ids = await pushCampaignLive({
    imageUrls: campaign.imageUrls,
    copyText: campaign.copyText,
    targetingParams: campaign.targetingParams,
    dailyBudgetCents: campaign.dailyBudgetCents,
    agencyName: campaign.agency.name,
    campaignId: campaign.id,
  });

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

  // Fire-and-forget, same pattern as the KYC approval email.
  void queueEmail(
    campaign.agency.email,
    "Your ad campaign is live",
    "Good news — your campaign has been approved and is now running on Meta and Google."
  );

  return updated;
}

// Reject a campaign awaiting review, with a reason, and email that reason back. */
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

// Pause a running campaign immediately on both platforms. 
export async function pauseCampaign(id: string) {
  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign) throw new CampaignError(404, "Campaign not found");
  if (campaign.status !== "ACTIVE") {
    throw new CampaignError(
      409,
      `Only active campaigns can be paused (current: ${campaign.status.toLowerCase()})`
    );
  }

  await pausePlatformCampaign({
    metaCampaignId: campaign.metaCampaignId ?? "",
    googleCampaignId: campaign.googleCampaignId ?? "",
    googleSearchCampaignId: campaign.googleSearchCampaignId ?? "",
  });

  return prisma.adCampaign.update({
    where: { id },
    data: { status: "PAUSED", pausedAt: new Date() },
  });
}

// Generate a new ad campaign with 3 creative variations for an agency.
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
  if (!agency.packages || agency.packages.length === 0) {
    throw new CampaignError(400, "No published packages found");
  }

  // Collect all photos from itineraries
  const allPhotos = agency.packages.flatMap((pkg) =>
    pkg.itineraries?.flatMap((it) => it.photos || []) || []
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
      copyText: `Affordable treks starting from $${Math.min(...agency.packages.map((p) => p.pricePerPerson.toNumber()))} with ${agency.name}.`,
      imageUrls: allPhotos.slice(3, 6),
    },
    {
      variant: 3,
      title: `Expert Guided Treks`,
      copyText: `Join ${agency.packages.length}+ treks led by experts. Book your next adventure today.`,
      imageUrls: allPhotos.slice(6, 9),
    },
  ];

  const campaign = await prisma.adCampaign.create({
    data: {
      agencyId,
      // A freshly generated campaign is a draft the agency still has to
      // configure targeting for and submit — `targetingBuilderService.ts`'s
      // `updateTargetingParams`/`submitCampaignForApproval` both require
      // `PENDING` and move it to `PENDING_APPROVAL` themselves on submit.
      // Creating it already at `PENDING_APPROVAL` (the previous behaviour)
      // skipped both steps entirely — they were unreachable through the
      // real generate → configure → submit flow.
      status: "PENDING",
      imageUrls: allPhotos,
      copyText: creativeVariations.map((c) => c.copyText).join(" | "),
      targetingParams: {
        creativeVariations,
        packageIds: agency.packages.map((p) => p.id),
      } as Record<
        string,
        Array<{ variant: number; title: string; copyText: string; imageUrls: string[] }> | string[]
      >,
    },
  });

  return campaign;
}

/** Fetch all campaigns for a specific agency. */
export async function getCampaigns(agencyId: string) {
  return prisma.adCampaign.findMany({
    where: { agencyId },
    orderBy: { createdAt: "desc" },
  });
}

/** Fetch a single campaign, verifying it belongs to the agency. */
export async function getCampaign(id: string, agencyId: string) {
  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign) throw new CampaignError(404, "Campaign not found");
  if (campaign.agencyId !== agencyId) {
    throw new CampaignError(403, "Not authorized to access this campaign");
  }
  return campaign;
}