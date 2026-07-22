-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "entry_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_agency_id_type_idx" ON "accounts"("agency_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_agency_id_code_key" ON "accounts"("agency_id", "code");

-- CreateIndex
CREATE INDEX "journal_entries_agency_id_entry_date_idx" ON "journal_entries"("agency_id", "entry_date");

-- CreateIndex
CREATE INDEX "journal_lines_journal_entry_id_idx" ON "journal_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "agency_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Double-entry enforcement (database level, Day 1 requirement):
-- every journal entry's lines must sum debit = credit.
-- ─────────────────────────────────────────────────────────────────────────────

-- Per-line sanity checks: amounts can never be negative, and a line is either
-- a debit or a credit — exactly one side must be positive, never both/neither.
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_non_negative_check"
  CHECK ("debit" >= 0 AND "credit" >= 0);

ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_one_side_check"
  CHECK (("debit" > 0 AND "credit" = 0) OR ("debit" = 0 AND "credit" > 0));

-- Per-entry balance check. A plain CHECK constraint cannot see other rows, so
-- this must be a trigger. It is a CONSTRAINT TRIGGER declared DEFERRABLE
-- INITIALLY DEFERRED: it runs at COMMIT, after ALL lines of the transaction
-- are inserted — otherwise inserting the first line of a two-line entry would
-- always fail (one line alone never balances).
CREATE OR REPLACE FUNCTION check_journal_entry_balanced()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_id TEXT;
  v_debit_total NUMERIC;
  v_credit_total NUMERIC;
BEGIN
  -- On DELETE the NEW row does not exist; use OLD instead.
  IF (TG_OP = 'DELETE') THEN
    v_entry_id := OLD.journal_entry_id;
  ELSE
    v_entry_id := NEW.journal_entry_id;
  END IF;

  -- If the parent entry itself was deleted (lines removed via ON DELETE
  -- CASCADE), there is nothing left to balance — allow it.
  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = v_entry_id) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit_total, v_credit_total
  FROM journal_lines
  WHERE journal_entry_id = v_entry_id;

  IF v_debit_total <> v_credit_total THEN
    RAISE EXCEPTION
      'Journal entry % is not balanced: total debit % <> total credit %',
      v_entry_id, v_debit_total, v_credit_total;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entry_balance_check
AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_journal_entry_balanced();
