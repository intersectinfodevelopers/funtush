-- CreateTable
CREATE TABLE "marketplace_impressions" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impression_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "conversion_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_clicks" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "trekker_id" TEXT,
    "destination" TEXT NOT NULL,
    "search_query" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_impressions_agency_id_idx" ON "marketplace_impressions"("agency_id");

-- CreateIndex
CREATE INDEX "marketplace_impressions_date_idx" ON "marketplace_impressions"("date");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_impressions_agency_id_date_key" ON "marketplace_impressions"("agency_id", "date");

-- CreateIndex
CREATE INDEX "marketplace_clicks_agency_id_idx" ON "marketplace_clicks"("agency_id");

-- CreateIndex
CREATE INDEX "marketplace_clicks_trekker_id_idx" ON "marketplace_clicks"("trekker_id");

-- CreateIndex
CREATE INDEX "marketplace_clicks_timestamp_idx" ON "marketplace_clicks"("timestamp");

-- AddForeignKey
ALTER TABLE "marketplace_impressions" ADD CONSTRAINT "marketplace_impressions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_clicks" ADD CONSTRAINT "marketplace_clicks_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_clicks" ADD CONSTRAINT "marketplace_clicks_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
