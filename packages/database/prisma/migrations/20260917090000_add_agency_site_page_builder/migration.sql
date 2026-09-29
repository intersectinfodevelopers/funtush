-- CreateEnum
CREATE TYPE "SitePageVariant" AS ENUM ('CLASSIC', 'MINIMAL', 'EDITORIAL', 'BOLD', 'ELEGANT', 'PLAYFUL');

-- CreateEnum
CREATE TYPE "SitePageHeaderStyle" AS ENUM ('STANDARD', 'CENTERED', 'CTA');

-- CreateEnum
CREATE TYPE "SitePageFooterStyle" AS ENUM ('BASIC', 'DETAILED', 'GRID', 'LOGO_GRID');

-- CreateEnum
CREATE TYPE "SitePageSectionType" AS ENUM ('TOPBAR', 'HERO', 'CATEGORIES', 'TEXTBLOCK', 'BLOGS', 'PACKAGES', 'DESTINATIONS', 'VIDEOS', 'GALLERY', 'REVIEWS', 'ADS');

-- CreateEnum
CREATE TYPE "SitePageHeroHeight" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'FULL');

-- CreateEnum
CREATE TYPE "SitePageMarqueeDirection" AS ENUM ('LTR', 'RTL');

-- CreateTable
CREATE TABLE "agency_site_pages" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "template_id" TEXT,
    "variant" "SitePageVariant" NOT NULL DEFAULT 'CLASSIC',
    "name" TEXT,
    "header_style" "SitePageHeaderStyle" NOT NULL DEFAULT 'STANDARD',
    "header_cta_text" TEXT,
    "header_cta_link" TEXT,
    "header_sticky" BOOLEAN NOT NULL DEFAULT true,
    "footer_style" "SitePageFooterStyle" NOT NULL DEFAULT 'BASIC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_site_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_site_page_sections" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "type" "SitePageSectionType" NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT,
    "text" TEXT,
    "subtitle" TEXT,
    "image" TEXT,
    "link" TEXT,
    "cta_text" TEXT,
    "cta_text_2" TEXT,
    "cta_link_2" TEXT,
    "hero_height" "SitePageHeroHeight",
    "overlay_enabled" BOOLEAN NOT NULL DEFAULT false,
    "font_size" INTEGER,
    "speed" INTEGER,
    "direction" "SitePageMarqueeDirection",
    "use_theme_bg" BOOLEAN NOT NULL DEFAULT true,
    "bg_color" TEXT,
    "use_theme_text" BOOLEAN NOT NULL DEFAULT true,
    "text_color" TEXT,
    "spacing_top" INTEGER,
    "spacing_bottom" INTEGER,
    "item_count" INTEGER,
    "selected_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "card_width" INTEGER,
    "card_height" INTEGER,
    "ad_position" TEXT,
    "width_percent" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_site_page_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_site_pages_agency_id_key" ON "agency_site_pages"("agency_id");

-- CreateIndex
CREATE INDEX "agency_site_page_sections_site_id_idx" ON "agency_site_page_sections"("site_id");

-- AddForeignKey
ALTER TABLE "agency_site_pages" ADD CONSTRAINT "agency_site_pages_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_site_page_sections" ADD CONSTRAINT "agency_site_page_sections_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "agency_site_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

