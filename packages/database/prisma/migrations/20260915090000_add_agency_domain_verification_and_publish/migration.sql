-- CreateEnum
CREATE TYPE "DomainVerificationStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED');

-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "custom_domain_status" "DomainVerificationStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "custom_domain_verification_token" TEXT,
ADD COLUMN     "custom_domain_verified_at" TIMESTAMP(3),
ADD COLUMN     "published_at" TIMESTAMP(3);
