-- Day 3: Itinerary Builder — add photos[] to itinerary days.
-- Applied directly to the database (additive, non-destructive).
ALTER TABLE "trek_itineraries"
  ADD COLUMN IF NOT EXISTS "photos" text[] NOT NULL DEFAULT ARRAY[]::text[];
