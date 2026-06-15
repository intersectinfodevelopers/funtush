

/*
  Warnings:

  - A unique constraint covering the columns `[agency_id,user_id]` on the table `agency_staff` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updated_at` to the `agency_staff` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "agency_staff" DROP CONSTRAINT "agency_staff_agency_id_fkey";

-- DropIndex
DROP INDEX "agency_staff_user_id_key";

-- AlterTable
ALTER TABLE "agency_staff" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "agency_staff_agency_id_idx" ON "agency_staff"("agency_id");

-- CreateIndex
CREATE INDEX "agency_staff_role_id_idx" ON "agency_staff"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_staff_agency_id_user_id_key" ON "agency_staff"("agency_id", "user_id");

-- AddForeignKey
ALTER TABLE "agency_staff" ADD CONSTRAINT "agency_staff_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
