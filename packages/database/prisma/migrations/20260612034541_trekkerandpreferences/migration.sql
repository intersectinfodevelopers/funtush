/*
  Warnings:

  - You are about to drop the column `created_at` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `password_hash` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `tenant_id` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `subscriptions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[agency_id,user_id]` on the table `agency_users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[token_hash]` on the table `refresh_tokens` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `trek_packages` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `user_id` to the `agency_users` table without a default value. This is not possible if the table is not empty.
  - Made the column `agency_id` on table `agency_users` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `slug` to the `trek_packages` table without a default value. This is not possible if the table is not empty.

*/

-- DropForeignKey
ALTER TABLE "agency_users" DROP CONSTRAINT "agency_users_agency_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";

-- AlterTable
ALTER TABLE "agency_users"
ALTER COLUMN "agency_id" SET NOT NULL;


-- CreateTable
CREATE TABLE "trekker" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "nationality" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trekker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trekker_preferences" (
    "id" TEXT NOT NULL,
    "trekker_id" TEXT NOT NULL,
    "preferred_destinations" JSONB,
    "budget_range" JSONB,
    "group_size_preference" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trekker_preferences_pkey" PRIMARY KEY ("id")
);





-- CreateIndex
CREATE UNIQUE INDEX "trekker_preferences_trekker_id_key" ON "trekker_preferences"("trekker_id");

-- AddForeignKey
ALTER TABLE "trekker" ADD CONSTRAINT "trekker_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trekker_preferences" ADD CONSTRAINT "trekker_preferences_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
