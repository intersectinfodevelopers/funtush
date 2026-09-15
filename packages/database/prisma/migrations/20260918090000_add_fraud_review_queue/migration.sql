-- CreateEnum
CREATE TYPE "FraudSignal" AS ENUM ('RED', 'ORANGE', 'YELLOW');

-- CreateEnum
CREATE TYPE "FraudFlagStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "BlocklistEntryType" AS ENUM ('FINGERPRINT', 'IP', 'EMAIL');

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "signal" "FraudSignal" NOT NULL,
    "status" "FraudFlagStatus" NOT NULL DEFAULT 'PENDING',
    "flags_triggered" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence_summary" TEXT,
    "fingerprint" TEXT,
    "ip" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocklist_entries" (
    "id" TEXT NOT NULL,
    "type" "BlocklistEntryType" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocklist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fraud_flags_agency_id_idx" ON "fraud_flags"("agency_id");

-- CreateIndex
CREATE INDEX "fraud_flags_status_idx" ON "fraud_flags"("status");

-- CreateIndex
CREATE UNIQUE INDEX "blocklist_entries_type_value_key" ON "blocklist_entries"("type", "value");

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocklist_entries" ADD CONSTRAINT "blocklist_entries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

