# @funtush/api

Funtush backend — Express + TypeScript, Prisma (PostgreSQL), MongoDB, Redis,
Meilisearch.

## Layout

- `src/app.ts` — builds the Express app (`createApp()` / `app`). No `listen`, no
  cron. Tests import this.
- `src/index.ts` — loads env, starts background jobs + Mongo/notification init,
  then `app.listen`. This is the process entrypoint (`npm run dev` / `start`).
- `src/routes/**` — routers. `src/routes/admin/index.ts` aggregates the admin
  sub-routers (all behind `requireAdmin`).
- `src/docs/openapi.ts` — OpenAPI spec (see `src/docs/README.md`). Served at
  `GET /docs` and `GET /docs.json` (prod: only when `ENABLE_DOCS=true`).

## Run locally

```bash
cp .env.example .env        # fill in DATABASE_URL / REDIS_URL / MONGO_URL / secrets
npm run dev                 # tsx watch on src/index.ts, port 4000
```

## Tests

Unit tests run without infra. The DB/Redis/Mongo/Meili-backed suites need the
throwaway containers in `docker-compose.test.yml` (non-standard ports so they
don't clash with anything already on the host). `.env.test` points at them.

```bash
npm run test:infra:up       # docker compose up -d --wait
npm run db:test:setup       # prisma migrate deploy against the test DB
npm test                    # vitest (loads .env.test via vitest.setup.ts)
npm run test:infra:down     # tear down + wipe volumes
```

`src/app.smoke.test.ts` boots the consolidated app in-process and asserts every
router is mounted, there are no duplicate `method + path` routes, and the
OpenAPI doc is well-formed.

## Checks

```bash
npm run typecheck           # tsc --noEmit
npm run lint                # eslint src
```
