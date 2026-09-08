-- Seed the canonical agency permission catalog.
--
-- Agency dashboard RBAC (funtush-frontend) toggles access by functional area with
-- lowercase section keys ("packages", "bookings", ...). RolePermission.permission_key
-- is an FK to permissions.key, so those rows must exist before a role can be granted
-- them. Idempotent — safe to re-run and safe on top of the legacy USER_*/AGENCY_* rows.
INSERT INTO "permissions" ("id", "key", "description", "created_at") VALUES
  (gen_random_uuid()::text, 'packages',  'Create and manage trek packages, itineraries and departure dates', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'bookings',  'Review, approve and manage bookings and guide assignments',        CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'guides',    'Manage guides, certifications and availability',                    CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'customers', 'View customer profiles, history and notes',                         CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'blog',      'Write and publish blog posts, categories and media',                CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'reviews',   'Respond to and moderate customer reviews',                          CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'finance',   'View finance dashboards, invoices and payouts',                     CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'analytics', 'View analytics and performance reports',                            CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'staff',     'Invite staff, manage roles and permissions',                        CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'settings',  'Edit agency profile, branding, widgets and site settings',          CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
