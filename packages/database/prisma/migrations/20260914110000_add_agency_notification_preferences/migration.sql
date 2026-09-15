-- CreateTable
CREATE TABLE "agency_notification_preferences" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "new_inquiry_email" BOOLEAN NOT NULL DEFAULT false,
    "new_inquiry_in_app" BOOLEAN NOT NULL DEFAULT true,
    "payment_received_email" BOOLEAN NOT NULL DEFAULT false,
    "payment_received_in_app" BOOLEAN NOT NULL DEFAULT true,
    "booking_cancelled_email" BOOLEAN NOT NULL DEFAULT false,
    "booking_cancelled_in_app" BOOLEAN NOT NULL DEFAULT true,
    "new_review_email" BOOLEAN NOT NULL DEFAULT false,
    "new_review_in_app" BOOLEAN NOT NULL DEFAULT true,
    "sos_triggered_email" BOOLEAN NOT NULL DEFAULT true,
    "sos_triggered_in_app" BOOLEAN NOT NULL DEFAULT true,
    "low_slots_email" BOOLEAN NOT NULL DEFAULT false,
    "low_slots_in_app" BOOLEAN NOT NULL DEFAULT true,
    "subscription_email" BOOLEAN NOT NULL DEFAULT false,
    "subscription_in_app" BOOLEAN NOT NULL DEFAULT true,
    "weekly_digest_email" BOOLEAN NOT NULL DEFAULT false,
    "weekly_digest_in_app" BOOLEAN NOT NULL DEFAULT true,
    "welcome_back_popup_enabled" BOOLEAN NOT NULL DEFAULT true,
    "welcome_back_popup_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_notification_preferences_agency_id_key" ON "agency_notification_preferences"("agency_id");

-- AddForeignKey
ALTER TABLE "agency_notification_preferences" ADD CONSTRAINT "agency_notification_preferences_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
