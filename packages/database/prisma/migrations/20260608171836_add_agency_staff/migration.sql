-- CreateTable
CREATE TABLE "agency_staff" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_staff_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "agency_staff_user_id_key" ON "agency_staff"("user_id");

-- AddForeignKey
ALTER TABLE "agency_staff" ADD CONSTRAINT "agency_staff_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_staff" ADD CONSTRAINT "agency_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "agency_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_staff" ADD CONSTRAINT "agency_staff_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
