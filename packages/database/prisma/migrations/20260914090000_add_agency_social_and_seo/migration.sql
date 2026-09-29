-- CreateTable
CREATE TABLE "agency_social_links" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "facebook_url" TEXT,
    "instagram_url" TEXT,
    "tiktok_url" TEXT,
    "whatsapp_number" TEXT,
    "youtube_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_seo_settings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "og_image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_seo_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_social_links_agency_id_key" ON "agency_social_links"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_seo_settings_agency_id_key" ON "agency_seo_settings"("agency_id");

-- AddForeignKey
ALTER TABLE "agency_social_links" ADD CONSTRAINT "agency_social_links_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_seo_settings" ADD CONSTRAINT "agency_seo_settings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
