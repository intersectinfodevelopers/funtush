ALTER TABLE "agency_customer_overrides" ADD COLUMN "email" TEXT;
ALTER TABLE "agency_destinations" ADD COLUMN "announced_at" TIMESTAMP(3);
-- Destinations that are already live were announced (or predate announcements): don't notify anyone about them retroactively.
UPDATE "agency_destinations" SET "announced_at" = now() WHERE "published" = true;
