-- CreateTable
CREATE TABLE "agency_email_settings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "sender_name" TEXT,
    "from_address" TEXT,
    "reply_to" TEXT,
    "footer_text" TEXT,
    "include_unsubscribe" BOOLEAN NOT NULL DEFAULT true,
    "bcc_bookings_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_email_settings_agency_id_key" ON "agency_email_settings"("agency_id");

-- AddForeignKey
ALTER TABLE "agency_email_settings" ADD CONSTRAINT "agency_email_settings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
