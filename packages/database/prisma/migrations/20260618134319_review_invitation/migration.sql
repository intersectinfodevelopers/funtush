-- CreateTable
CREATE TABLE "review_invitations" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_invitations_booking_id_key" ON "review_invitations"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_invitations_token_key" ON "review_invitations"("token");

-- AddForeignKey
ALTER TABLE "review_invitations" ADD CONSTRAINT "review_invitations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
