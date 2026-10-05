# Load test

`loadtest.mjs` is a gentle, **read-only** load test for the Funtush API. It needs only Node 18+
(no extra tooling) and never tries to get around the API's rate limiter.

| Phase | What it does |
|---|---|
| 0 — baseline | 5 sequential requests per endpoint (latency without concurrency) |
| 1 — sustained | 3 req/s for 60 s (~180 requests, under the per-route limit), mixed public + agency-authenticated reads |
| 2 — burst | 20 concurrent connections for 15 s on **one** DB-backed route — shows the rate limiter and load shedding rejecting cleanly (200 → 429) and the API recovering |
| 3 — capacity *(local targets only)* | 190 requests per route at 10 and 50 concurrent, counters reset before each run, so the limiter never trips |

It aborts a phase if more than 9 of the last 30 requests are 5xx/network errors. The only write is
one login (`agency@funtush.com` — the seeded QA account, see `docs/QA_TEST_ACCOUNTS.md`).

## Run it locally

Use the throwaway test infrastructure — never your dev database.

```bash
cd apps/api
pnpm test:infra:up && pnpm db:test:setup                 # postgres/redis/mongo/meili on non-standard ports
(cd ../../packages/database && DATABASE_URL="postgresql://funtush:funtush@localhost:5542/funtush?schema=public" pnpm db:seed)

# Production mode, clustered, 2 workers (like the staging VPS). Secrets are throwaway and only live in this process.
NODE_ENV=production PORT=4100 WEB_CONCURRENCY=2 ENABLE_DOCS=true PLATFORM_HOSTS=localhost,127.0.0.1 SKIP_ADMIN_IP_CHECK=false \
  DATABASE_URL="postgresql://funtush:funtush@localhost:5542/funtush?schema=public" REDIS_URL=redis://localhost:6399 \
  MONGO_URL=mongodb://localhost:27217/funtush_test MONGO_DB=funtush_test MEILI_HOST=http://localhost:7701 MEILI_MASTER_KEY=test-master-key \
  JWT_ACCESS_SECRET=$(openssl rand -hex 32) JWT_REFRESH_SECRET=$(openssl rand -hex 32) ENCRYPTION_KEY=$(openssl rand -hex 32) \
  ../../node_modules/.bin/tsx src/cluster.ts &

TARGET=http://localhost:4100 node ../../tests/load/loadtest.mjs
```

For a local target the script resets the rate-limit counters in the test Redis container
(`REDIS_CONTAINER`, default `api-redis-1`) instead of waiting out the window.

## Run it against a remote environment (e.g. staging)

```bash
TARGET=https://develop.shirijanga.com node tests/load/loadtest.mjs
# optional: sample the server's load average / container CPU between phases
SSH_HOST=shirijanga-root TARGET=https://develop.shirijanga.com node tests/load/loadtest.mjs
```

`SSH_HOST` must be an SSH alias with a `funtush-api` Docker container. Remote runs take ~4–5 minutes
(they wait out the rate-limit window between phases). Be considerate: staging shares a small VPS.

Other options: `QA_EMAIL` / `QA_PASSWORD` (login for the authenticated reads).

## Reading the results

- **Network dominates remote runs.** From Nepal through Cloudflare the floor is ~200 ms, so compare
  *tail* latency (p95/p99) and the local run, not the p50.
- **The limiter is per IP *and exact path*.** The Redis key is `ratelimit:{ip}:{method}:{path}`, so the
  200/min cap applies to each route separately. A burst spread over many routes will not produce a 429 — that is
  why phase 2 uses a single route.
- **One client can't find true capacity.** Phase 3 (local only) gives per-route throughput; for a
  real ceiling run the generator from another machine, with the target on dedicated hardware.

### Reference run — 2026-10-06 (2 workers each)

| | Staging VPS via Cloudflare | Local |
|---|---|---|
| Baseline | 205–300 ms | 8–43 ms |
| Sustained 3 req/s: p50 / p95 / p99 | 243 / 1,587 / 3,235 ms | 13 / 113 / 169 ms |
| Burst: served / rejected (429) | 200 / 971 | 200 / 3,717 |
| 5xx errors | 0 | 0 |

Local capacity (190 req/route): `/health` 170–399 req/s, `/marketplace/agencies` 165–274,
`/marketplace/packages` ~125–128 (flat from 10 → 50 connections), `/subscription-tiers` 89–133,
`/agencies/me/dashboard` 38–50 req/s (p95 1.8 s at 50 connections) — the slowest route.

The staging tail was inflated by an unrelated cause: another process on the VPS was using most of its
2 CPUs during the run, so treat the staging numbers as a floor, not as the API's capability.
