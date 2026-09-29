-- AlterTable
ALTER TABLE "esewa_transactions" ADD COLUMN     "discount_amount_off" DOUBLE PRECISION,
ADD COLUMN     "discount_code_id" TEXT;

-- AlterTable
ALTER TABLE "khalti_transactions" ADD COLUMN     "discount_amount_off" DOUBLE PRECISION,
ADD COLUMN     "discount_code_id" TEXT;

-- AddForeignKey
ALTER TABLE "khalti_transactions" ADD CONSTRAINT "khalti_transactions_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "tier_discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esewa_transactions" ADD CONSTRAINT "esewa_transactions_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "tier_discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
