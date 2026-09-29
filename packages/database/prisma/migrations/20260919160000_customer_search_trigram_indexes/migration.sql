-- Customer search is `ILIKE '%term%'` over name / phone / email. A plain b-tree
-- can't serve a leading wildcard, so every search sequentially scanned the whole
-- trekker and users tables (~165ms at 50k customers, and it grows linearly).
-- Trigram GIN indexes make substring search an index lookup.
--
-- pg_trgm ships with PostgreSQL (contrib); on managed databases it is
-- allow-listed (RDS, Cloud SQL, Supabase, Neon). Requires CREATE EXTENSION rights.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "trekker_full_name_trgm_idx" ON "trekker" USING gin ("fullName" gin_trgm_ops);
CREATE INDEX "trekker_phone_trgm_idx" ON "trekker" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "users_email_trgm_idx" ON "users" USING gin ("email" gin_trgm_ops);
