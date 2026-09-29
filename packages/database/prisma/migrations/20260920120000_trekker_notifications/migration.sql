-- In-app notifications for trekkers (written by notifyTrekker alongside the push).
CREATE TABLE IF NOT EXISTS "trekker_notifications" (
    "id" TEXT NOT NULL,
    "trekker_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trekker_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "trekker_notifications_trekker_id_created_at_idx" ON "trekker_notifications"("trekker_id", "created_at");
CREATE INDEX IF NOT EXISTS "trekker_notifications_trekker_id_read_at_idx" ON "trekker_notifications"("trekker_id", "read_at");
DO $$ BEGIN
  ALTER TABLE "trekker_notifications" ADD CONSTRAINT "trekker_notifications_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
