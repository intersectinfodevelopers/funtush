CREATE TABLE "package_activity" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "package_title" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "actor_email" TEXT,
    "actor_role" TEXT NOT NULL,
    "summary" TEXT,
    "changes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "package_activity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "package_activity_agency_id_created_at_idx" ON "package_activity"("agency_id", "created_at");
CREATE INDEX "package_activity_package_id_created_at_idx" ON "package_activity"("package_id", "created_at");
