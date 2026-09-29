-- Found by load testing (40k bookings on one agency): the agency bookings list
-- (WHERE agency_id = ? [AND status = ?] ORDER BY created_at DESC LIMIT n) had to
-- sort every one of the agency's bookings on each request, and the customers
-- list aggregates by trekker within an agency.
CREATE INDEX "bookings_agency_id_created_at_idx" ON "bookings"("agency_id", "created_at");
CREATE INDEX "bookings_agency_id_status_created_at_idx" ON "bookings"("agency_id", "status", "created_at");
CREATE INDEX "bookings_agency_id_trekker_id_idx" ON "bookings"("agency_id", "trekker_id");
