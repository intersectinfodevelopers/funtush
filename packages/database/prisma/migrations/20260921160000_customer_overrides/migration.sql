CREATE TABLE "agency_customer_overrides" (
    "agency_id" TEXT NOT NULL,
    "customer_key" TEXT NOT NULL,
    "full_name" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "hidden_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agency_customer_overrides_pkey" PRIMARY KEY ("agency_id","customer_key")
);
ALTER TABLE "agency_customer_overrides" ADD CONSTRAINT "agency_customer_overrides_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guests (no Funtush account) who completed a trek are customers too; this keeps that lookup an index scan.
CREATE INDEX "bookings_guest_completed_idx" ON "bookings" ("agency_id", (lower("trekker_email")))
    WHERE "trekker_id" IS NULL AND "status" = 'COMPLETED';
