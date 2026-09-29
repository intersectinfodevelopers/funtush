-- Tenant resolution looks agencies up by custom_domain on every request to a
-- custom-domain site; without an index that's a sequential scan of agencies.
CREATE INDEX "agencies_custom_domain_idx" ON "agencies"("custom_domain");

-- Composite (owner, sort key) indexes for the paginated agency-scoped lists:
-- WHERE agency_id = ? ORDER BY created_at DESC LIMIT n.
CREATE INDEX "reviews_agency_id_created_at_idx" ON "reviews"("agency_id", "created_at");
CREATE INDEX "blogs_agency_id_created_at_idx" ON "blogs"("agency_id", "created_at");
CREATE INDEX "trek_packages_agency_id_created_at_idx" ON "trek_packages"("agency_id", "created_at");

-- Departure lookups filter by package and a date range / ordering.
CREATE INDEX "trek_departure_dates_package_id_start_date_idx" ON "trek_departure_dates"("package_id", "start_date");
