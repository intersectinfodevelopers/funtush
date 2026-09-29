-- A branch name only has to be unique within its own agency; the global unique
-- index let one agency's "Pokhara" block (and reveal) every other agency's.
DROP INDEX IF EXISTS "branches_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "branches_agency_id_name_key" ON "branches"("agency_id", "name");
