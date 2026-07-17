-- CreateTable
CREATE TABLE "agency_payment_methods" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials_encrypted" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_payment_methods_agency_id_idx" ON "agency_payment_methods"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_payment_methods_agency_id_provider_key" ON "agency_payment_methods"("agency_id", "provider");

-- AddForeignKey
ALTER TABLE "agency_payment_methods" ADD CONSTRAINT "agency_payment_methods_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
