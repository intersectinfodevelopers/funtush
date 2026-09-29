-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL', 'BOTH');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "tier_discount_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "applies_to_tier_id" TEXT,
    "billing_cycle" "BillingCycle" NOT NULL DEFAULT 'BOTH',
    "max_redemptions" INTEGER,
    "times_redeemed" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tier_discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tier_discount_redemptions" (
    "id" TEXT NOT NULL,
    "discount_code_id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "amount_off" DECIMAL(10,2) NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tier_discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tier_discount_codes_code_key" ON "tier_discount_codes"("code");

-- CreateIndex
CREATE INDEX "tier_discount_redemptions_discount_code_id_idx" ON "tier_discount_redemptions"("discount_code_id");

-- CreateIndex
CREATE INDEX "tier_discount_redemptions_agency_id_idx" ON "tier_discount_redemptions"("agency_id");

-- AddForeignKey
ALTER TABLE "tier_discount_codes" ADD CONSTRAINT "tier_discount_codes_applies_to_tier_id_fkey" FOREIGN KEY ("applies_to_tier_id") REFERENCES "subscription_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tier_discount_redemptions" ADD CONSTRAINT "tier_discount_redemptions_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "tier_discount_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tier_discount_redemptions" ADD CONSTRAINT "tier_discount_redemptions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
