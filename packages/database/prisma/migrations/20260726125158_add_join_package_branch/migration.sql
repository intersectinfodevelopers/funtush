-- NOTE: The `rotated_at`, `kyc_submissions.created_at/updated_at`,
-- `stripe_subscriptions.current_period_start` columns and the
-- agency_payment_methods/kyc_submissions/stripe_subscriptions indexes were
-- already created by the earlier migration 20260723071823_sync_kyc_stripe_columns.
-- Re-adding them here made `prisma migrate deploy` fail on a fresh database with
-- "column already exists" (error 42701), breaking CI. This migration now keeps
-- only the statements unique to the branch-assignment feature.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "trek_packages" ADD COLUMN     "availableToAllBranches" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PackageBranch" (
    "packageId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "PackageBranch_pkey" PRIMARY KEY ("packageId","branchId")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_name_key" ON "branches"("name");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageBranch" ADD CONSTRAINT "PackageBranch_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageBranch" ADD CONSTRAINT "PackageBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
