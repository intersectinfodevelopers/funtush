ALTER TABLE "categories" ADD COLUMN "slug" TEXT;
ALTER TABLE "categories" ADD COLUMN "color" TEXT NOT NULL DEFAULT '#358CBD';
ALTER TABLE "categories" ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Existing categories get a slug made from their name; a repeat within one agency gets a numeric suffix.
WITH base AS (
  SELECT id, agency_id,
         COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'category') AS s,
         created_at
  FROM "categories"
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY agency_id, s ORDER BY created_at, id) AS rn FROM base
)
UPDATE "categories" c SET "slug" = CASE WHEN r.rn = 1 THEN r.s ELSE r.s || '-' || r.rn END
FROM ranked r WHERE r.id = c.id;

ALTER TABLE "categories" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "categories_agency_id_slug_key" ON "categories"("agency_id", "slug");
