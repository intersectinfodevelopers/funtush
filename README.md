# funtush

Funtush is a private travel and tours SaaS project.

## Branch model
- `main`: protected release branch
- `develop`: protected integration branch
- Feature branches should branch from `develop`


## Repository scaffold
- Issue templates live in `.github/ISSUE_TEMPLATE/`
- Pull request template lives in `.github/PULL_REQUEST_TEMPLATE.md`
- CODEOWNERS lives at the repository root
- CI workflows live in `.github/workflows/`

## Monorepo

Plain JavaScript (ESM), managed with [Turborepo](https://turbo.build) +
[pnpm](https://pnpm.io) workspaces. Requires Node.js >= 22 and pnpm >= 11.
See [docs/MONOREPO.md](docs/MONOREPO.md) for the full explainer.

```bash
pnpm install bcrypt jsonwebtoken node nodemailer express pg
```
apps/
  api/      @funtush/api      Node.js + Express backend
  web/      @funtush/web      Public marketplace + dashboard (placeholder)
  mobile/   @funtush/mobile   React Native guide/trekker app (placeholder)
packages/
  shared/   @funtush/shared   Shared utilities (tenant helpers)
  database/ @funtush/database Data-access layer (Postgres/Mongo/Redis)
  ui/       @funtush/ui       Shared UI primitives + design tokens
config/     @funtush/config   Shared ESLint preset
```

## Environment Variables

```env
DATABASE_URL
```


### Commands

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # turbo run dev (watch mode across packages)
pnpm lint           # turbo run lint
pnpm test           # turbo run test
pnpm format         # prettier --write
```

There is no build step â plain JS runs directly under Node. Internal packages
are linked via `workspace:*` and Turborepo runs/caches tasks across them.

## Next steps
- Build out Phase 1 (multi-tenant DB layer, auth, subscriptions)
- Set the project website URL
- Add organization teams and members
