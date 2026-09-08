-- Restore the `payrolls` table.
--
-- Migration 20260804122927_add_bug_workflow (a botched merge) runs
-- `DROP TABLE payrolls` and nothing in the committed chain re-creates it, so a
-- fresh `migrate deploy` ends with the schema's `Payroll` model unbacked
-- (drift). This re-creates it to match packages/database/prisma/schema.prisma.
-- IF NOT EXISTS keeps it a no-op on databases where the table still exists.

DO $$ BEGIN
  CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "payrolls" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "payrolls_journal_entry_id_key" ON "payrolls"("journal_entry_id");
CREATE INDEX IF NOT EXISTS "payrolls_agency_id_status_idx" ON "payrolls"("agency_id", "status");
CREATE INDEX IF NOT EXISTS "payrolls_agency_id_period_start_idx" ON "payrolls"("agency_id", "period_start");
CREATE INDEX IF NOT EXISTS "payrolls_guide_id_idx" ON "payrolls"("guide_id");
CREATE INDEX IF NOT EXISTS "payrolls_staff_id_idx" ON "payrolls"("staff_id");

DO $$ BEGIN
  ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "agency_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "agency_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
