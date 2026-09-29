-- Per-agency customer summary, kept current by a trigger on bookings.
--
-- Why: the customers list used to GROUP BY trekker over every booking of the
-- agency on each request. Fine at hundreds of customers; at 10-50k customers
-- per agency (and 20k agencies) it is a full scan per page view. This table is
-- one row per (agency, customer), so a page is an index range scan.

CREATE TABLE "agency_customer_stats" (
    "agency_id" TEXT NOT NULL,
    "trekker_id" TEXT NOT NULL,
    "total_bookings" INTEGER NOT NULL,
    "total_spent" DECIMAL(14,2) NOT NULL,
    "last_booking_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_customer_stats_pkey" PRIMARY KEY ("agency_id","trekker_id")
);

CREATE INDEX "acs_agency_last_booking_idx" ON "agency_customer_stats"("agency_id", "last_booking_at" DESC, "trekker_id");
CREATE INDEX "acs_agency_spent_idx" ON "agency_customer_stats"("agency_id", "total_spent" DESC, "trekker_id");
CREATE INDEX "acs_agency_bookings_idx" ON "agency_customer_stats"("agency_id", "total_bookings" DESC, "trekker_id");
CREATE INDEX "acs_trekker_idx" ON "agency_customer_stats"("trekker_id");

ALTER TABLE "agency_customer_stats" ADD CONSTRAINT "agency_customer_stats_trekker_id_fkey"
    FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from existing bookings. (On a very large table run this during a
-- quiet window, or in agency-sized batches; it is a single GROUP BY.)
INSERT INTO "agency_customer_stats" ("agency_id", "trekker_id", "total_bookings", "total_spent", "last_booking_at")
SELECT "agency_id", "trekker_id", count(*), COALESCE(sum("total_price"), 0), max("created_at")
FROM "bookings"
WHERE "trekker_id" IS NOT NULL
GROUP BY "agency_id", "trekker_id";

CREATE FUNCTION acs_add(p_agency TEXT, p_trekker TEXT, p_price NUMERIC, p_created TIMESTAMP)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO agency_customer_stats AS s (agency_id, trekker_id, total_bookings, total_spent, last_booking_at)
  VALUES (p_agency, p_trekker, 1, p_price, p_created)
  ON CONFLICT (agency_id, trekker_id) DO UPDATE SET
    total_bookings  = s.total_bookings + 1,
    total_spent     = s.total_spent + EXCLUDED.total_spent,
    last_booking_at = GREATEST(s.last_booking_at, EXCLUDED.last_booking_at);
END $$;

-- Runs AFTER the change, so the bookings table no longer contains the removed
-- row and last_booking_at can be recomputed from what is left.
CREATE FUNCTION acs_remove(p_agency TEXT, p_trekker TEXT, p_price NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agency_customer_stats
     SET total_bookings = total_bookings - 1,
         total_spent    = total_spent - p_price
   WHERE agency_id = p_agency AND trekker_id = p_trekker;

  DELETE FROM agency_customer_stats
   WHERE agency_id = p_agency AND trekker_id = p_trekker AND total_bookings <= 0;

  UPDATE agency_customer_stats s
     SET last_booking_at = COALESCE(
           (SELECT max(b.created_at) FROM bookings b WHERE b.agency_id = p_agency AND b.trekker_id = p_trekker),
           s.last_booking_at)
   WHERE s.agency_id = p_agency AND s.trekker_id = p_trekker;
END $$;

CREATE FUNCTION bookings_customer_stats_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.trekker_id IS NOT NULL THEN
      PERFORM acs_add(NEW.agency_id, NEW.trekker_id, NEW.total_price, NEW.created_at);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.trekker_id IS NOT NULL THEN
      PERFORM acs_remove(OLD.agency_id, OLD.trekker_id, OLD.total_price);
    END IF;
  ELSE -- UPDATE of agency_id / trekker_id / total_price / created_at
    IF OLD.trekker_id IS NOT NULL THEN
      PERFORM acs_remove(OLD.agency_id, OLD.trekker_id, OLD.total_price);
    END IF;
    IF NEW.trekker_id IS NOT NULL THEN
      PERFORM acs_add(NEW.agency_id, NEW.trekker_id, NEW.total_price, NEW.created_at);
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER bookings_customer_stats
AFTER INSERT OR DELETE OR UPDATE OF agency_id, trekker_id, total_price, created_at ON bookings
FOR EACH ROW EXECUTE FUNCTION bookings_customer_stats_fn();
