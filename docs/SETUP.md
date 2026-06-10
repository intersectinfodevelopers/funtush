# Funtush Backend — Setup Guide

> **Scope:** Week 1 — Monorepo & Database foundation (Dipesh Singh, `feature/ds/monorepo-setup`).
> This guide gets a new developer from a fresh clone to a running API with a seeded
> database, covering Day 1 → Day 5 deliverables.
>
> For *why* the monorepo is structured the way it is, see [MONOREPO.md](./MONOREPO.md).

---

## 1. What's in this foundation

| Day | Deliverable | Where it lives |
| --- | --- | --- |
| **Day 1** | Monorepo (pnpm + Turborepo), Express API, `.env.example` | repo root, [`apps/api`](../apps/api) |
| **Day 2** | PostgreSQL schema + Prisma migration + seed data | [`packages/database/prisma`](../packages/database/prisma) |
| **Day 3** | Redis client + cache / rate-limit / session helpers | [`packages/database/src/redis.ts`](../packages/database/src/redis.ts) |
| **Day 4** | `GET /health`, response helpers, pagination, permissions | [`apps/api/src/index.ts`](../apps/api/src/index.ts), [`packages/utils`](../packages/utils) |
| **Day 5** | Integration tests (DB, Redis, health, utils) + this guide | `*.test.ts` across packages |

---

## 2. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | `>= 22` | enforced by `engines` in [package.json](../package.json) |
| **pnpm** | `>= 11` (pinned `11.5.1`) | `corepack enable` then `corepack prepare pnpm@11.5.1 --activate` |
| **PostgreSQL** | 14+ | listening on `localhost:5432` |
| **Redis** | 6+ | listening on `localhost:6379` |

### Quick start for the data stores (Docker)

If you don't have Postgres/Redis installed locally, the fastest path is Docker:

```bash
docker run -d --name funtush-pg \
  -e POSTGRES_USER=funtush -e POSTGRES_PASSWORD=funtush -e POSTGRES_DB=funtush \
  -p 5432:5432 postgres:16

docker run -d --name funtush-redis -p 6379:6379 redis:7 
```

These match the default credentials in [`.env.example`](../.env.example).

---

## 3. First-time setup

Run these from the **repo root**.

```bash
# 1. Install all workspace dependencies (apps/* + packages/* + config)
pnpm install

# 2. Create your local environment file from the template
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
#   then edit .env if your DB/Redis credentials differ

# 3. Generate the Prisma client (creates the typed DB client from the schema)
pnpm --filter @funtush/database db:generate

# 4. Apply database migrations (creates the tables in your Postgres DB)
pnpm --filter @funtush/database db:migrate

# 5. Seed baseline data (4 subscription tiers + Super Admin)
pnpm --filter @funtush/database db:seed
```

After step 5 you'll have:

- **4 subscription tiers:** `FREE`, `SMALL`, `MEDIUM`, `LARGE`
- **Super Admin login:** `admin@funtush.com` / `ChangeMe123!` &nbsp;⚠️ _change this in any shared environment._

> **Note on `db:migrate`:** it must be run from a real interactive terminal. If Prisma
> detects schema changes it will prompt for a migration name — a non-interactive shell
> will appear to hang. The committed `init` migration already creates the agency tables,
> so on a clean DB this just applies cleanly.

---

## 4. Running the project

```bash
# Start everything in dev mode (Turbo runs each app's `dev` task)
pnpm dev

# Or just the API
pnpm --filter @funtush/api dev
```

The API listens on **`http://localhost:4000`** (override with `PORT` in `.env`).

### Verify it's up

```bash
curl http://localhost:4000/health
```

Healthy response (`200`):

```json
{ "status": "ok", "db": "ok", "redis": "ok" }
```

If a dependency is down you get `503` with that service marked `"error"`. The health
check probes **PostgreSQL** (`SELECT 1`) and **Redis** (`PING`) — see
[`apps/api/src/index.ts`](../apps/api/src/index.ts).

---

## 5. Environment variables

All variables live in [`.env.example`](../.env.example). Copy it to `.env` and adjust.

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection (Prisma) | `postgresql://funtush:funtush@localhost:5432/funtush?schema=public` |
| `REDIS_URL` | Redis — sessions, cache, rate limiting | `redis://localhost:6379` |
| `JWT_SECRET` | Auth token signing | _replace with a long random string_ |
| `PORT` | API port | `4000` |

---

## 6. Common commands

Run from the repo root (Turbo fans them out across all packages):

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode |
| `pnpm test` | Run all test suites (Vitest) |
| `pnpm typecheck` | Type-check every package |
| `pnpm lint` | ESLint across the workspace |
| `pnpm format` | Prettier write |
| `pnpm clean` | Remove build/cache artifacts |

Database-specific (run with `--filter @funtush/database` or from inside the package):

| Command | What it does |
| --- | --- |
| `db:generate` | Regenerate the Prisma client after a schema change |
| `db:migrate` | Create + apply a dev migration |
| `db:seed` | Insert tiers + Super Admin |
| `db:studio` | Open Prisma Studio (DB GUI) |

---

## 7. Package overview

| Package | Purpose |
| --- | --- |
| [`@funtush/api`](../apps/api) | Express server, `/health`, agency routes |
| [`@funtush/database`](../packages/database) | Postgres (`db`) + Redis (`redis`) clients, Prisma schema, Redis helpers |
| [`@funtush/utils`](../packages/utils) | `success/error/paginated` responses, `paginate()`, `PERMISSIONS` constants |
| [`@funtush/shared`](../packages/shared) | Cross-cutting helpers (tenant isolation: `tenantKey`) |
| [`@funtush/config`](../config) | Shared ESLint preset + base tsconfig |
| `@funtush/auth`, `@funtush/types`, `@funtush/ui` | Owned by other developers / later weeks |

### Database package exports ([`packages/database/src`](../packages/database/src))

```ts
import {
  db,            // pg Pool — PostgreSQL
  redis,         // ioredis client
  setCache, getCache, deleteCache,        // cache helpers (JSON + TTL)
  checkRateLimit,                         // fixed-window rate limiter
  setSession, getSession,                 // 1-day session store
} from "@funtush/database";
```

| Helper | Signature |
| --- | --- |
| `setCache` | `(key: string, value: unknown, ttlSeconds: number) => Promise<void>` |
| `getCache` | `<T>(key: string) => Promise<T \| null>` |
| `deleteCache` | `(key: string) => Promise<void>` |
| `checkRateLimit` | `(ip: string, limit: number, windowSeconds: number) => Promise<boolean>` |
| `setSession` | `(userId: string, data: unknown) => Promise<void>` |
| `getSession` | `<T>(userId: string) => Promise<T \| null>` |

You can sanity-check the Redis wiring without the API:

```bash
pnpm --filter @funtush/database exec tsx src/verify-redis.ts
```

### Utility helpers ([`packages/utils/src`](../packages/utils/src))

```ts
import { success, error, paginated, paginate, PERMISSIONS } from "@funtush/utils";

success(data);                       // { success: true, data }
error("Not found", 404);             // { success: false, error: { message, code } }
paginated(rows, meta);               // { success: true, data, meta }
paginate(page, limit);               // → { skip, take }  (defaults page=1, limit=20, max 100)
```

---

## 8. Database schema

Defined in [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma):

- **SubscriptionTier** — `name`, `maxStaff`, `maxGuides`, `monthlyPrice`, `features` (JSON)
- **Agency** — `name`, `email`, `slug`, `status` (`TRIAL/ACTIVE/LOCKED/SUSPENDED`), `tier` → SubscriptionTier, `trialExpiresAt`
- **AgencyUser** — `email`, `passwordHash`, `role` (`SUPER_ADMIN/AGENCY_ADMIN/STAFF`), nullable `tenantId`/`agencyId`
- **RefreshToken** — `userId` → AgencyUser, `tokenHash`, `expiresAt`
- **Role / Permission / RolePermission** — RBAC tables (owned by the Roles & Storage workstream)

---

## 9. Running tests

```bash
pnpm test
```

Coverage in this foundation:

| Test file | Covers |
| --- | --- |
| [`apps/api/src/health.test.ts`](../apps/api/src/health.test.ts) | `/health` returns ok/error for DB + Redis |
| [`packages/database/src/redis.test.ts`](../packages/database/src/redis.test.ts) | cache, rate limit, session helpers |
| [`packages/database/src/db.test.ts`](../packages/database/src/db.test.ts) | Postgres pool client |
| [`packages/utils/src/response.test.ts`](../packages/utils/src/response.test.ts) | response envelopes |
| [`packages/utils/src/pagination.test.ts`](../packages/utils/src/pagination.test.ts) | pagination defaults & clamping |
| [`packages/utils/src/permissions.test.ts`](../packages/utils/src/permissions.test.ts) | permission constants |
| [`packages/shared/src/tenant.test.ts`](../packages/shared/src/tenant.test.ts) | tenant key isolation |

---

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find module '@prisma/client'` / `PrismaClient` not exported | Run `pnpm --filter @funtush/database db:generate` |
| `/health` returns `503` with `db: error` | Postgres isn't running / `DATABASE_URL` wrong |
| `/health` returns `503` with `redis: error` | Redis isn't running / `REDIS_URL` wrong |
| `db:migrate` seems to hang | It's waiting for a migration name — run it in a real terminal, not a script |
| Type errors after pulling new code | `pnpm install` then `pnpm --filter @funtush/database db:generate` |
