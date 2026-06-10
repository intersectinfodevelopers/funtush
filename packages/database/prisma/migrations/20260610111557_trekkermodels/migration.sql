-- CreateTable
CREATE TABLE "trekkers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trekkers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trekker_preferences" (
    "id" TEXT NOT NULL,
    "trekkerId" TEXT NOT NULL,
    "preferredDestinations" TEXT[],
    "budgetRange" TEXT,
    "groupSizePreference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trekker_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trekkers_email_key" ON "trekkers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "trekker_preferences_trekkerId_key" ON "trekker_preferences"("trekkerId");

-- AddForeignKey
ALTER TABLE "trekker_preferences" ADD CONSTRAINT "trekker_preferences_trekkerId_fkey" FOREIGN KEY ("trekkerId") REFERENCES "trekkers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
