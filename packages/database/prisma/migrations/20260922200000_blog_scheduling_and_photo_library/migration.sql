ALTER TABLE "blogs" ADD COLUMN "publish_at" TIMESTAMP(3);
CREATE INDEX "blogs_status_publish_at_idx" ON "blogs"("status", "publish_at");

CREATE TABLE "blog_photos" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blog_photos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "blog_photos_agency_id_url_key" ON "blog_photos"("agency_id", "url");
CREATE INDEX "blog_photos_agency_id_created_at_idx" ON "blog_photos"("agency_id", "created_at");
ALTER TABLE "blog_photos" ADD CONSTRAINT "blog_photos_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
