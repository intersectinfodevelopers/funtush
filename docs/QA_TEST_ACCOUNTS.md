# QA test accounts

Accounts used by the *Funtush API QA Test Plan*. They are created by the DB seed
(`packages/database/prisma/seed.ts`), which is idempotent: every write is an
upsert, so it is safe to re-run. Re-running also **resets these accounts'
passwords** back to the seed password.

| Email | Role | Login endpoint | Use for |
|---|---|---|---|
| `admin@funtush.com` | SUPER_ADMIN | `POST /auth/admin/login` | `/admin/*`, `/emails/*`, admin bug routes; wrong-role tests |
| `agency@funtush.com` | AGENCY_ADMIN | `POST /auth/agency/login` | `/agencies/me/*`, bookings, packages, finance |
| `test@auth.com` | Trekker | `POST /auth/trekker/login` | primary trekker: profile, notifications, SOS, mobile |
| `john@test.com` | Trekker | `POST /auth/trekker/login` | second trekker, for cross-user (IDOR) tests |

Default password for all four: `Test@123` (override with `QA_ACCOUNTS_PASSWORD`).

The seed also creates the fixtures those tests rely on: the four subscription
tiers (FREE / SMALL / MEDIUM / LARGE), "Default Agency" (`agency@funtush.com`),
two published test packages, a departure date, itinerary days, one confirmed
booking by John, and one review.

Not seeded — create these through the API while testing:

- **2nd agency** (cross-tenant IDOR tests): `POST /register/agency`
- **Agency staff** with a limited custom role: `POST /agencies/me/staff`
- **Throwaway users** for password change/reset, lockout, break-glass and ban tests

## Marketplace test data

The public marketplace (`/marketplace/*`) shows **only** data that passes its visibility rules, so the default QA
agency (`agency@funtush.com`) is invisible there **by design**: it is a FREE-tier / TRIAL agency, and anything created
under it stays hidden. A package is visible only when its agency is **ACTIVE**, on a **paid tier** (SMALL or above)
and — for `/marketplace/agencies` and ranking — **KYC APPROVED**; and the package itself must be **PUBLISHED and in the
search index** (data inserted straight into the database is not indexed until `search:reindex` runs).
`/marketplace/stats` is deliberately different: it counts *all* registered agencies and published packages.

`seed:marketplace-demo` creates data that satisfies all of that, then reindexes search:

| | |
|---|---|
| Agencies | `himalayan-trails-demo` (MEDIUM) and `annapurna-adventures-demo` (LARGE, sponsored) — ACTIVE, KYC approved, full profile |
| Packages (6, all PUBLISHED, future departures) | `demo-everest-base-camp`, `demo-langtang-valley`, `demo-gokyo-lakes`, `demo-annapurna-circuit`, `demo-poon-hill`, `demo-mardi-himal` — EASY, MODERATE, CHALLENGING and DIFFICULT, 420–1,900 USD, 5–18 days |
| Reviews | 4 verified (from `john@test.com` and `test@auth.com`) |

```bash
# local / test database
pnpm --filter @funtush/api seed:marketplace-demo
# staging server (production mode needs the confirmation flag)
docker exec -e QA_SEED_CONFIRM=staging funtush-api sh -c "cd /app/apps/api && pnpm seed:marketplace-demo"
# optional: also make agency@funtush.com itself marketplace-visible (SMALL tier, ACTIVE, KYC approved)
docker exec -e QA_SEED_CONFIRM=staging -e PROMOTE_DEFAULT_AGENCY=1 funtush-api sh -c "cd /app/apps/api && pnpm seed:marketplace-demo"
```

Re-running is safe; it resets these rows. Packages created later through the API under a paid, ACTIVE agency are
indexed when they are **published**. `GET /marketplace/seasonal` matches the current month/season *word* in a
destination's best-season text ("Autumn"), so it returns nothing in June–August for this data.

## Testing from Swagger (`/docs`)

Open `/docs`, expand a login endpoint, pick the account from the **Examples**
dropdown and press **Execute**. A successful login authorizes the page
automatically (the bearer token **and** `x-refresh-token`), and the
authorization survives a reload. Log in as another account to switch role.

| Role | Login | What the routes need |
|---|---|---|
| Super admin | `POST /auth/admin/login` | `Authorization: Bearer <accessToken>` — `/admin/*`, `/emails/*` |
| Agency admin | `POST /auth/agency/login` | `x-refresh-token: <refreshToken>` — `/agencies/me/*`, `/billing/*` (the bearer token alone is rejected) |

A super-admin token is rejected on agency routes and vice-versa; that is the
role separation working. If Swagger still shows old examples after a deploy,
that was a cached `swagger-ui-init.js` — it is now versioned per spec and sent
`no-store`, so it should not recur.

## Running the seed

Local / test database:

```bash
pnpm --filter @funtush/database db:seed
```

Staging (the API runs with `NODE_ENV=production`). The seed refuses to run in
production unless you confirm, so it can't be pointed at a real production
database by accident:

```bash
cd /path/to/funtush                      # on the staging server
docker exec -e QA_SEED_CONFIRM=staging funtush-api \
  sh -c "cd /app/packages/database && pnpm db:seed"
```

## Security

These credentials are public (they live in this repo). Only seed them into
local, test and staging databases — never a database holding real customer
data. Staging is on the public internet, so change the `admin@funtush.com`
password after the first login, or set `QA_ACCOUNTS_PASSWORD` to something
private (then update your Postman environment to match).

Refresh tokens are single-use: after `POST /auth/refresh`, store the **new**
refresh token or every later `x-refresh-token` call will fail.
