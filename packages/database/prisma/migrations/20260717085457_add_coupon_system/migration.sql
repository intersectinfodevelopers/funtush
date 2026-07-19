-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" DOUBLE PRECISION NOT NULL,
    "applicable_packages" TEXT[],
    "min_booking_value" DOUBLE PRECISION,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "max_redemptions" INTEGER NOT NULL DEFAULT 0,
    "redemptions_used" INTEGER NOT NULL DEFAULT 0,
    "first_time_trekker_only" BOOLEAN NOT NULL DEFAULT false,
    "min_group_size" INTEGER,
    "status" "CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_agency_id_code_key" ON "coupons"("agency_id", "code");

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
