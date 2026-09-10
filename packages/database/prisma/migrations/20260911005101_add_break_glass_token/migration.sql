-- CreateTable
CREATE TABLE "break_glass_tokens" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_by_ip" TEXT NOT NULL,
    "issued_by" TEXT,
    "reason" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_glass_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "break_glass_tokens_token_hash_key" ON "break_glass_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "break_glass_tokens_agency_id_idx" ON "break_glass_tokens"("agency_id");

-- CreateIndex
CREATE INDEX "break_glass_tokens_expires_at_idx" ON "break_glass_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "break_glass_tokens" ADD CONSTRAINT "break_glass_tokens_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

