-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "booking_id" TEXT,
ADD COLUMN     "currency_code" TEXT NOT NULL DEFAULT 'NPR';

-- CreateIndex
CREATE INDEX "journal_entries_booking_id_idx" ON "journal_entries"("booking_id");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
