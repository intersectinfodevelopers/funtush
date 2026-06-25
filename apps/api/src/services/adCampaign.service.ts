/**
 * Ad campaign queue — business logic.
 *
 * Mirrors the KYC service: queue of PENDING items reviewed by an admin who
 * either approves (push live on Meta + Google) or rejects (email reason back),
 * plus monitoring of ACTIVE campaigns and an immediate pause.
 *
 * Lives under src/services/.
 */
import { prisma } from "../packages/database/prisma";
import { queueEmail } from "../lib/emailQueue";
import { pushCampaignLive, pausePlatformCampaign } from "../lib/adPlatforms";

// Match this to your AgencyTier enum value for the "Large" tier.
const LARGE_TIER = "LARGE" as const;

/** Thrown by the service; the route maps `.status` onto the HTTP response. */
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

/** All PENDING campaigns from Large-tier agencies, oldest first (FIFO review). */
export async function getPendingCampaigns() {
  return prisma.adCampaign.findMany({
    where: { status: "PENDING", agency: { tier: LARGE_TIER } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      imageUrls: true,
      copyText: true,
      targetingParams: true,
      createdAt: true,
      agency: { select: agencySummary },
    },
  });
}

/** All ACTIVE campaigns with their stored delivery metrics. */
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

/** Approve a pending campaign: push it live, mark ACTIVE, notify the agency. */
export async function approveCampaign(id: string) {
  const campaign = await prisma.adCampaign.findUnique({
    where: { id },
    include: { agency: { select: agencySummary } },
  });
  if (!campaign) throw new CampaignError(404, "Campaign not found");
  if (campaign.status !== "PENDING") {
    throw new CampaignError(409, `Campaign already ${campaign.status.toLowerCase()}`);
  }

  // Push live on Meta + Google BEFORE marking active, so a failed push leaves
  // the campaign PENDING rather than ACTIVE-but-not-running.
  const ids = await pushCampaignLive({
    imageUrls: campaign.imageUrls,
    copyText: campaign.copyText,
    targetingParams: campaign.targetingParams,
  });

  const updated = await prisma.adCampaign.update({
    where: { id },
    data: {
      status: "ACTIVE",
      metaCampaignId: ids.metaCampaignId,
      googleCampaignId: ids.googleCampaignId,
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

/** Reject a pending campaign with a reason, and email that reason back. */
export async function rejectCampaign(id: string, reason: string) {
  if (!reason || !reason.trim()) {
    throw new CampaignError(400, "Rejection reason is required");
  }

  const campaign = await prisma.adCampaign.findUnique({
    where: { id },
    include: { agency: { select: agencySummary } },
  });
  if (!campaign) throw new CampaignError(404, "Campaign not found");
  if (campaign.status !== "PENDING") {
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

/** Pause a running campaign immediately on both platforms. */
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
  });

  return prisma.adCampaign.update({
    where: { id },
    data: { status: "PAUSED", pausedAt: new Date() },
  });
}