ALTER TABLE "blogs" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "blogs" SET "tags" = ARRAY[tag] WHERE tag IS NOT NULL AND btrim(tag) <> '';
ALTER TABLE "blogs" DROP COLUMN "tag";
