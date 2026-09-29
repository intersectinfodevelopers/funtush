-- AlterTable
ALTER TABLE "users" ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
