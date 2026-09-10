-- CreateEnum
CREATE TYPE "DomainMappingStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "domain_mappings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verification_token" TEXT NOT NULL,
    "status" "DomainMappingStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_mappings_agency_id_key" ON "domain_mappings"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_mappings_domain_key" ON "domain_mappings"("domain");

-- CreateIndex
CREATE INDEX "domain_mappings_status_idx" ON "domain_mappings"("status");

-- AddForeignKey
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

