/*
  Warnings:

  - You are about to drop the `trekkers` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[user_id]` on the table `trekker` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_trekker_id_fkey";

-- DropForeignKey
ALTER TABLE "trekkers" DROP CONSTRAINT "trekkers_user_id_fkey";

-- DropTable
DROP TABLE "trekkers";

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "trekker_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "note_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "trekker_id" TEXT NOT NULL,
    "staff_id" TEXT,
    "type" "CommunicationType" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_notes_agency_id_trekker_id_idx" ON "customer_notes"("agency_id", "trekker_id");

-- CreateIndex
CREATE INDEX "communication_logs_agency_id_trekker_id_idx" ON "communication_logs"("agency_id", "trekker_id");

-- CreateIndex
CREATE UNIQUE INDEX "trekker_user_id_key" ON "trekker"("user_id");

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "agency_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "agency_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
