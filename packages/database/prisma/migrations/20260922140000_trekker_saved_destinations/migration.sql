CREATE TABLE "trekker_saved_destinations" (
    "trekker_id" TEXT NOT NULL,
    "destination_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trekker_saved_destinations_pkey" PRIMARY KEY ("trekker_id","destination_id")
);
CREATE INDEX "trekker_saved_destinations_destination_id_idx" ON "trekker_saved_destinations"("destination_id");
ALTER TABLE "trekker_saved_destinations" ADD CONSTRAINT "trekker_saved_destinations_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trekker_saved_destinations" ADD CONSTRAINT "trekker_saved_destinations_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "agency_destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
