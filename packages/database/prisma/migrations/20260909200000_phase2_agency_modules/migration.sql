-- Phase 2 agency-dashboard modules: guides (HR fields + certifications), gallery,
-- videos, agency destinations, site ads, trekker invoices, safety warnings, plus
-- Super-Admin subscription-tier config fields and agency-staff display profile.

-- CreateEnum
CREATE TYPE "GuideStatus" AS ENUM ('AVAILABLE', 'ON_TREK', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "SiteAdStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "TrekkerInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "GalleryStatus" AS ENUM ('PUBLISHED', 'DRAFT');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum
ALTER TYPE "AgencyStatus" ADD VALUE 'BANNED';

-- AlterTable
ALTER TABLE "subscription_tiers" ADD COLUMN     "ads_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "annual_price" DECIMAL(10,2),
ADD COLUMN     "api_access_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "custom_domain_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketplace_weight" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "max_packages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trial_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "white_label_complete" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "ban_reason" TEXT,
ADD COLUMN     "banned_at" TIMESTAMP(3),
ADD COLUMN     "risk_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "agency_staff" ADD COLUMN     "name" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "guide_profiles" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "photo_url" TEXT,
ADD COLUMN     "rating" DECIMAL(3,2),
ADD COLUMN     "sex" TEXT,
ADD COLUMN     "status" "GuideStatus" NOT NULL DEFAULT 'AVAILABLE';

-- CreateTable
CREATE TABLE "agency_destinations" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "short_description" TEXT,
    "long_description" TEXT,
    "region" TEXT,
    "difficulty" TEXT,
    "activities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featured_image" TEXT,
    "gallery" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_min_days" INTEGER,
    "duration_max_days" INTEGER,
    "altitude_min_m" INTEGER,
    "altitude_max_m" INTEGER,
    "best_time_to_visit" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "rating" DECIMAL(3,2),
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_ads" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "link_url" TEXT,
    "position" TEXT NOT NULL,
    "status" "SiteAdStatus" NOT NULL DEFAULT 'ACTIVE',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "start_date" DATE,
    "end_date" DATE,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trekker_invoices" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "booking_id" TEXT,
    "trekker_name" TEXT NOT NULL,
    "trekker_email" TEXT,
    "package_name" TEXT,
    "line_items" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency_code" TEXT NOT NULL DEFAULT 'NPR',
    "status" "TrekkerInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE,
    "due_date" DATE,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trekker_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_certifications" (
    "id" TEXT NOT NULL,
    "guide_profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuing_body" TEXT,
    "number" TEXT NOT NULL,
    "expiry" DATE NOT NULL,
    "document_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guide_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_posts" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featured_image" TEXT,
    "status" "GalleryStatus" NOT NULL DEFAULT 'PUBLISHED',
    "order" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gallery_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "videos" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "youtube_url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'ACTIVE',
    "order" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_warnings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "issued_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_destinations_agency_id_published_idx" ON "agency_destinations"("agency_id", "published");

-- CreateIndex
CREATE UNIQUE INDEX "agency_destinations_agency_id_slug_key" ON "agency_destinations"("agency_id", "slug");

-- CreateIndex
CREATE INDEX "site_ads_agency_id_position_idx" ON "site_ads"("agency_id", "position");

-- CreateIndex
CREATE INDEX "trekker_invoices_agency_id_status_idx" ON "trekker_invoices"("agency_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trekker_invoices_agency_id_invoice_number_key" ON "trekker_invoices"("agency_id", "invoice_number");

-- CreateIndex
CREATE INDEX "guide_certifications_guide_profile_id_idx" ON "guide_certifications"("guide_profile_id");

-- CreateIndex
CREATE INDEX "gallery_posts_agency_id_status_idx" ON "gallery_posts"("agency_id", "status");

-- CreateIndex
CREATE INDEX "videos_agency_id_status_idx" ON "videos"("agency_id", "status");

-- CreateIndex
CREATE INDEX "safety_warnings_agency_id_idx" ON "safety_warnings"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_tenant_id_key" ON "agencies"("tenant_id");

-- AddForeignKey
ALTER TABLE "agency_destinations" ADD CONSTRAINT "agency_destinations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ads" ADD CONSTRAINT "site_ads_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trekker_invoices" ADD CONSTRAINT "trekker_invoices_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trekker_invoices" ADD CONSTRAINT "trekker_invoices_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_certifications" ADD CONSTRAINT "guide_certifications_guide_profile_id_fkey" FOREIGN KEY ("guide_profile_id") REFERENCES "guide_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_posts" ADD CONSTRAINT "gallery_posts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_warnings" ADD CONSTRAINT "safety_warnings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
