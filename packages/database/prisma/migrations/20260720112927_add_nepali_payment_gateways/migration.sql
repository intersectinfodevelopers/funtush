-- CreateTable
CREATE TABLE "khalti_transactions" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "khalti_token" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "khalti_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esewa_transactions" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "esewa_ref_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esewa_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectips_transactions" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectips_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nepali_payment_verifications" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nepali_payment_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "khalti_transactions_agency_id_idx" ON "khalti_transactions"("agency_id");

-- CreateIndex
CREATE INDEX "khalti_transactions_status_idx" ON "khalti_transactions"("status");

-- CreateIndex
CREATE INDEX "esewa_transactions_agency_id_idx" ON "esewa_transactions"("agency_id");

-- CreateIndex
CREATE INDEX "esewa_transactions_status_idx" ON "esewa_transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "connectips_transactions_transfer_id_key" ON "connectips_transactions"("transfer_id");

-- CreateIndex
CREATE INDEX "connectips_transactions_agency_id_idx" ON "connectips_transactions"("agency_id");

-- CreateIndex
CREATE INDEX "connectips_transactions_status_idx" ON "connectips_transactions"("status");

-- CreateIndex
CREATE INDEX "nepali_payment_verifications_agency_id_idx" ON "nepali_payment_verifications"("agency_id");

-- CreateIndex
CREATE INDEX "nepali_payment_verifications_provider_idx" ON "nepali_payment_verifications"("provider");

-- CreateIndex
CREATE INDEX "nepali_payment_verifications_status_idx" ON "nepali_payment_verifications"("status");

-- AddForeignKey
ALTER TABLE "khalti_transactions" ADD CONSTRAINT "khalti_transactions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esewa_transactions" ADD CONSTRAINT "esewa_transactions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectips_transactions" ADD CONSTRAINT "connectips_transactions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nepali_payment_verifications" ADD CONSTRAINT "nepali_payment_verifications_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
