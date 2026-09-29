-- Adds users.normalized_email — the real uniqueness guard against Gmail's
-- dot/plus-alias tricks (john.doe@gmail.com / johndoe@gmail.com /
-- john+x@gmail.com all land in one real inbox but compare as different
-- strings against a plain `email` unique constraint). Application code
-- computes this with normalizeEmail() from @funtush/shared on every write;
-- this migration backfills existing rows with the equivalent logic in SQL
-- before enforcing NOT NULL + UNIQUE.
--
-- NOTE: if this environment already has real duplicate accounts that only
-- differ by dot/plus aliasing, the UNIQUE index below will fail to create —
-- that's surfacing a pre-existing data problem (those "different" accounts
-- were always the same mailbox), not something this migration can safely
-- resolve on its own; it would need a manual merge first.

-- AddColumn (nullable first, so the backfill below has something to write into)
ALTER TABLE "users" ADD COLUMN "normalized_email" TEXT;

-- Backfill, mirroring normalizeEmail(): lowercase; for gmail.com/googlemail.com,
-- drop everything from "+" onward in the local part, strip dots, and
-- canonicalize the domain to gmail.com; everything else is just lowercased.
UPDATE "users"
SET "normalized_email" = CASE
  WHEN split_part(lower("email"), '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(split_part(lower("email"), '@', 1), '+', 1), '.', '') || '@gmail.com'
  ELSE lower("email")
END;

-- Enforce
ALTER TABLE "users" ALTER COLUMN "normalized_email" SET NOT NULL;
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");
