-- CreateEnum
CREATE TYPE "AdCampaignStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'PAUSED');

-- CreateTable
CREATE TABLE "agency_visibility_scores" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "base_score" INTEGER NOT NULL DEFAULT 0,
    "quality_bonus" INTEGER NOT NULL DEFAULT 0,
    "final_score" INTEGER NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_visibility_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "status" "AdCampaignStatus" NOT NULL DEFAULT 'PENDING',
    "imageUrls" TEXT[],
    "copyText" TEXT NOT NULL,
    "targetingParams" JSONB NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "metaCampaignId" TEXT,
    "googleCampaignId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_visibility_scores_agency_id_key" ON "agency_visibility_scores"("agency_id");

-- CreateIndex
CREATE INDEX "agency_visibility_scores_final_score_idx" ON "agency_visibility_scores"("final_score");

-- CreateIndex
CREATE INDEX "AdCampaign_status_idx" ON "AdCampaign"("status");

-- CreateIndex
CREATE INDEX "AdCampaign_agencyId_idx" ON "AdCampaign"("agencyId");

-- AddForeignKey
ALTER TABLE "agency_visibility_scores" ADD CONSTRAINT "agency_visibility_scores_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
