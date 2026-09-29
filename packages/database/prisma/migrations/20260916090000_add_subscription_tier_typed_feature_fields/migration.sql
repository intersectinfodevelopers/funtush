-- AlterTable
ALTER TABLE "subscription_tiers" ADD COLUMN     "max_bookings_per_month" INTEGER,
ADD COLUMN     "blog_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "analytics_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority_support_enabled" BOOLEAN NOT NULL DEFAULT false;
