-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DepartureStatus" AS ENUM ('AVAILABLE', 'FULL', 'GUARANTEED');

-- CreateEnum
CREATE TYPE "TrekDifficulty" AS ENUM ('EASY', 'MODERATE', 'CHALLENGING', 'DIFFICULT');

-- CreateTable
CREATE TABLE "trek_packages" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "duration_days" INTEGER NOT NULL,
    "price_per_person" DECIMAL(10,2) NOT NULL,
    "difficulty" "TrekDifficulty" NOT NULL,
    "max_group_size" INTEGER NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trek_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_destinations" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "altitude_m" INTEGER,
    "best_season" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trek_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_itineraries" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "day_number" INTEGER NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "altitude_m" INTEGER,

    CONSTRAINT "trek_itineraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_departure_dates" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "max_slots" INTEGER NOT NULL,
    "booked_slots" INTEGER NOT NULL DEFAULT 0,
    "status" "DepartureStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "trek_departure_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_add_ons" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "per_person" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trek_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TrekDestinationToTrekPackage" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TrekDestinationToTrekPackage_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "trek_packages_agency_id_idx" ON "trek_packages"("agency_id");

-- CreateIndex
CREATE INDEX "trek_destinations_agency_id_idx" ON "trek_destinations"("agency_id");

-- CreateIndex
CREATE INDEX "trek_itineraries_package_id_idx" ON "trek_itineraries"("package_id");

-- CreateIndex
CREATE INDEX "trek_departure_dates_package_id_idx" ON "trek_departure_dates"("package_id");

-- CreateIndex
CREATE INDEX "trek_add_ons_package_id_idx" ON "trek_add_ons"("package_id");

-- CreateIndex
CREATE INDEX "_TrekDestinationToTrekPackage_B_index" ON "_TrekDestinationToTrekPackage"("B");

-- AddForeignKey
ALTER TABLE "trek_packages" ADD CONSTRAINT "trek_packages_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_destinations" ADD CONSTRAINT "trek_destinations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_itineraries" ADD CONSTRAINT "trek_itineraries_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_departure_dates" ADD CONSTRAINT "trek_departure_dates_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_add_ons" ADD CONSTRAINT "trek_add_ons_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TrekDestinationToTrekPackage" ADD CONSTRAINT "_TrekDestinationToTrekPackage_A_fkey" FOREIGN KEY ("A") REFERENCES "trek_destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TrekDestinationToTrekPackage" ADD CONSTRAINT "_TrekDestinationToTrekPackage_B_fkey" FOREIGN KEY ("B") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
