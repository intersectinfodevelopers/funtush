-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'PAID');

-- CreateTable
CREATE TABLE "payrolls" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "guide_id" TEXT,
    "staff_id" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'NPR',
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "booking_id" TEXT,
    "notes" TEXT,
    "journal_entry_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_journal_entry_id_key" ON "payrolls"("journal_entry_id");

-- CreateIndex
CREATE INDEX "payrolls_agency_id_status_idx" ON "payrolls"("agency_id", "status");

-- CreateIndex
CREATE INDEX "payrolls_agency_id_period_start_idx" ON "payrolls"("agency_id", "period_start");

-- CreateIndex
CREATE INDEX "payrolls_guide_id_idx" ON "payrolls"("guide_id");

-- CreateIndex
CREATE INDEX "payrolls_staff_id_idx" ON "payrolls"("staff_id");

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "agency_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "agency_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Payroll integrity rules the Prisma schema cannot express (Day 3).
-- The service validates all of these too; these are the last line of defence,
-- exactly like the double-entry balance trigger from Day 1.
-- ─────────────────────────────────────────────────────────────────────────────

-- A payroll row pays exactly one person: either a guide or a staff member,
-- never both and never neither.
ALTER TABLE "payrolls"
  ADD CONSTRAINT "payrolls_one_payee_check"
  CHECK (
    ("guide_id" IS NOT NULL AND "staff_id" IS NULL)
    OR ("guide_id" IS NULL AND "staff_id" IS NOT NULL)
  );

-- You cannot owe someone a negative or zero salary.
ALTER TABLE "payrolls"
  ADD CONSTRAINT "payrolls_amount_positive_check"
  CHECK ("amount" > 0);

-- A pay period must not run backwards.
ALTER TABLE "payrolls"
  ADD CONSTRAINT "payrolls_period_order_check"
  CHECK ("period_end" >= "period_start");

-- PAID rows must carry their ledger entry and payment timestamp; DRAFT rows
-- must carry neither. This is what makes "payroll is reflected in the ledger"
-- an invariant rather than a hope.
ALTER TABLE "payrolls"
  ADD CONSTRAINT "payrolls_paid_has_journal_entry_check"
  CHECK (
    ("status" = 'DRAFT' AND "journal_entry_id" IS NULL AND "paid_at" IS NULL)
    OR ("status" = 'PAID' AND "journal_entry_id" IS NOT NULL AND "paid_at" IS NOT NULL)
  );
