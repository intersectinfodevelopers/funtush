-- CreateTable
CREATE TABLE "stripe_subscriptions" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "grace_until" TIMESTAMP(3),
    "last_invoice_id" TEXT,
    "last_invoice_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_webhook_logs" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stripe_subscriptions_agency_id_key" ON "stripe_subscriptions"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_subscriptions_stripe_customer_id_key" ON "stripe_subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_subscriptions_stripe_subscription_id_key" ON "stripe_subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "stripe_subscriptions_agency_id_idx" ON "stripe_subscriptions"("agency_id");

-- CreateIndex
CREATE INDEX "stripe_subscriptions_status_idx" ON "stripe_subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_webhook_logs_event_id_key" ON "stripe_webhook_logs"("event_id");

-- CreateIndex
CREATE INDEX "stripe_webhook_logs_event_type_idx" ON "stripe_webhook_logs"("event_type");

-- CreateIndex
CREATE INDEX "stripe_webhook_logs_status_idx" ON "stripe_webhook_logs"("status");

-- AddForeignKey
ALTER TABLE "stripe_subscriptions" ADD CONSTRAINT "stripe_subscriptions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
