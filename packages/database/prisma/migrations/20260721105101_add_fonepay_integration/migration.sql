-- CreateTable
CREATE TABLE "fonepay_qr_codes" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "qr_code_url" TEXT NOT NULL,
    "qrType" TEXT NOT NULL DEFAULT 'static',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fonepay_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fonepay_transactions" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "trekker_email" TEXT NOT NULL,
    "booking_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee_percentage" DOUBLE PRECISION NOT NULL,
    "fee_amount" DOUBLE PRECISION NOT NULL,
    "net_amount" DOUBLE PRECISION NOT NULL,
    "transaction_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fonepay_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_fees" (
    "id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "fee_percentage" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fonepay_qr_codes_agency_id_key" ON "fonepay_qr_codes"("agency_id");

-- CreateIndex
CREATE INDEX "fonepay_qr_codes_agency_id_idx" ON "fonepay_qr_codes"("agency_id");

-- CreateIndex
CREATE INDEX "fonepay_transactions_agency_id_idx" ON "fonepay_transactions"("agency_id");

-- CreateIndex
CREATE INDEX "fonepay_transactions_status_idx" ON "fonepay_transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_fees_tier_id_key" ON "transaction_fees"("tier_id");

-- AddForeignKey
ALTER TABLE "fonepay_qr_codes" ADD CONSTRAINT "fonepay_qr_codes_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fonepay_transactions" ADD CONSTRAINT "fonepay_transactions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
