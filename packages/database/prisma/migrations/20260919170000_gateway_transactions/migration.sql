-- A gateway transaction id may confirm at most one booking (see the model's doc).
CREATE TABLE "gateway_transactions" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gateway_transactions_gateway_transaction_id_key" ON "gateway_transactions"("gateway", "transaction_id");
CREATE INDEX "gateway_transactions_booking_id_idx" ON "gateway_transactions"("booking_id");
