# Funtush Monorepo â Setup Guide & Change Log

This document explains the Turborepo + pnpm monorepo that was added on top of the
original README-only scaffold: what it is, every file that was created or changed,
**why** each change was made, the packages that get installed, and how to install
and run everything.

The codebase is **plain JavaScript (ESM)** â no TypeScript, no compile step.

> If you only want to get running: jump to [Install & Run](#7-install--run).

---

## 1. What this monorepo is

Funtush is a **B2B2C multi-tenant SaaS marketplace** for trekking agencies. The
Funtush Backend Intern Reference Guide (Â§2) mandates a **Turborepo + pnpm**
monorepo so that multiple product surfaces â the agency API, the public web
marketplace, the mobile app, and shared libraries â live in **one repository**,
share code through internal packages, and are orchestrated by one task runner.

A monorepo gives us:

- **Shared code without publishing** â `@funtush/shared`, `@funtush/database`, and
  `@funtush/ui` are imported by the apps directly via the `workspace:*` protocol,
  so a change to a shared helper is instantly visible everywhere.
- **One dependency tree** â pnpm installs everything once and links packages with
  symlinks, so versions stay consistent and disk usage stays low.
- **Orchestrated, cached tasks** â Turborepo runs tasks (`lint`, `test`, `dev`)
  across all packages, parallelizes them, and **caches results**, so unchanged
  packages are skipped (`>>> FULL TURBO`).

Because the code is plain JavaScript, **there is no build step**: Node runs the
`src/*.js` files directly, and each package exposes its `src/index.js` as its
entry point.

---

## 2. Why Turborepo + pnpm specifically

| Tool | Role | Why it was chosen |
|---|---|---|
| **pnpm** | Package manager + workspaces | Fast, disk-efficient (content-addressable store), strict (a package can only import deps it declares), and has first-class monorepo workspace support. Mandated by the Backend Guide. |
| **Turborepo** | Task runner / orchestrator | Runs tasks across all packages, parallelizes independent work, and **caches task outputs** so nothing re-runs unnecessarily. |
| **JavaScript (ESM)** | Language | No compile step; `node` runs sources directly. `"type": "module"` makes every package a native ES module. |

---

## 3. Directory layout

```
funtush/
âââ apps/                     # Runnable applications
â   âââ api/      @funtush/api      Node.js + Express backend
â   âââ web/      @funtush/web      Public marketplace + dashboard (placeholder)
â   âââ mobile/   @funtush/mobile   React Native guide/trekker app (placeholder)
âââ packages/                 # Shared internal libraries
â   âââ shared/   @funtush/shared   Shared utilities (tenant helpers)
â   âââ database/ @funtush/database Data-access layer (Postgres/Redis boundary)
â   âââ ui/       @funtush/ui       Shared UI primitives + design tokens
âââ config/       @funtush/config   Shared ESLint preset
âââ docs/                     # Documentation (this file lives here)
âââ infra/  scripts/  tests/  # Existing scaffold dirs (unchanged)
âââ package.json              # Root workspace manifest
âââ pnpm-workspace.yaml       # Declares which folders are workspaces
âââ turbo.json                # Turborepo task pipeline
âââ eslint.config.mjs / .prettierrc.json / .npmrc
```

**Naming convention:** every workspace is published internally under the
`@funtush/*` scope. `apps/*` are things you run/deploy; `packages/*` are libraries
the apps consume; `config/` is shared tooling.

---

## 4. Every file added or changed (and why)

### 4.1 Root workspace plumbing

| File | New/Changed | Why |
|---|---|---|
| [`package.json`](../package.json) | **New** | The root manifest. Declares the repo `private`, pins the package manager (`pnpm@11.5.1`), sets the Node engine (`>=22`), holds shared dev tooling, and exposes turbo-driven scripts (`dev`, `lint`, `test`, `clean`, `format`). |
| [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) | **New** | Tells pnpm which folders are workspace packages (`apps/*`, `packages/*`, `config`). Without this, pnpm treats the repo as a single package and `workspace:*` links don't resolve. Also pins `allowBuilds: esbuild` so the native esbuild binary (used by `vitest`) is allowed to run its install script. |
| [`turbo.json`](../turbo.json) | **New** | Defines the task graph: `dev` (uncached, `persistent` watcher), `lint`, `test`, and `clean`. No `build`/`typecheck` tasks â plain JS needs neither. |
| [`.npmrc`](../.npmrc) | **New** | pnpm settings: auto-install peer deps and keep a strict (non-hoisted) `node_modules` so packages can't accidentally import undeclared dependencies. |
| [`.prettierrc.json`](../.prettierrc.json) | **New** | Shared formatting rules (2-space indent, semicolons, double quotes, 100-col width). |
| [`.prettierignore`](../.prettierignore) | **New** | Keeps Prettier away from generated/vendored output (`node_modules`, `.turbo`, the lockfile). |
| [`eslint.config.mjs`](../eslint.config.mjs) | **New** | Root ESLint **flat config**. It re-exports the shared preset from `@funtush/config`, so ESLint run from any package resolves one source of truth. |
| [`.gitignore`](../.gitignore) | **Changed** | Added `.turbo/` (turbo cache) and `.claude/` (local agent files) so they don't get committed. |
| [`README.md`](../README.md) | **Changed** | Added a "Monorepo" section documenting the layout and the common commands. |

### 4.2 Shared config package â `@funtush/config`

Tooling config is shared through one package so every workspace stays consistent
and a rule change happens in one place.

| File | Why |
|---|---|
| [`config/package.json`](../config/package.json) | Declares the `@funtush/config` package and `exports` its ESLint preset under `@funtush/config/eslint`. |
| [`config/eslint-preset.mjs`](../config/eslint-preset.mjs) | The actual ESLint rule set: JS recommended rules (`@eslint/js`), Node globals (`globals.node` so `process`/`console` aren't flagged), ESM source type, and an `argsIgnorePattern: "^_"` rule so intentionally-unused params like `_req` don't error. |

### 4.3 Library packages

Each follows the same shape: a `package.json` (with `lint`/`test`/`clean`
scripts) and a `src/` folder. The package's `main`/`exports` point straight at
`src/index.js` â no build output.

| Package | Files | Why it exists |
|---|---|---|
| **`@funtush/shared`** | [`package.json`](../packages/shared/package.json), [`src/index.js`](../packages/shared/src/index.js), [`src/tenant.js`](../packages/shared/src/tenant.js), [`src/tenant.test.js`](../packages/shared/src/tenant.test.js) | Cross-cutting utilities used everywhere. Includes a `tenantKey()` helper â the foundation of the Backend Guide's #1 rule (tenant isolation). The test file proves the test runner works. |
| **`@funtush/database`** | [`package.json`](../packages/database/package.json), [`src/index.js`](../packages/database/src/index.js) | The data-access boundary for the primary stores (Postgres/Redis). Currently a placeholder; real clients are wired up in Phase 1. Depends on `@funtush/shared` â demonstrates internal package linking. |
| **`@funtush/ui`** | [`package.json`](../packages/ui/package.json), [`src/index.js`](../packages/ui/src/index.js) | Shared design tokens / UI primitives for the web + white-label surfaces. Placeholder for now. |

### 4.4 Apps

| App | Files | Why |
|---|---|---|
| **`@funtush/api`** | [`package.json`](../apps/api/package.json), [`src/index.js`](../apps/api/src/index.js) | The real backend. A minimal **Express** server exposing `GET /health`. Uses Node's built-in `node --watch` for dev and `node` for start. |
| **`@funtush/web`** | [`package.json`](../apps/web/package.json), [`src/index.js`](../apps/web/src/index.js) | Placeholder entry point for the public marketplace / dashboard. The web framework (e.g. Next.js) is chosen in Phase 2. Depends on `@funtush/shared` + `@funtush/ui`. |
| **`@funtush/mobile`** | [`package.json`](../apps/mobile/package.json), [`src/index.js`](../apps/mobile/src/index.js) | Placeholder for the React Native guide/trekker app (Phase 3, alongside GPS/SOS). Kept in the workspace so wiring stays consistent. |

### 4.5 CI workflows (changed)

The GitHub Actions workflows were migrated from **npm** to **pnpm + turbo**,
because the repo is now a pnpm workspace (a bare `npm ci` would fail).

| File | Change |
|---|---|
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Setup pnpm + Node 22 (with pnpm cache) â `pnpm install --frozen-lockfile` â `lint` â `test`. |
| [`.github/workflows/lint.yml`](../.github/workflows/lint.yml) | Same setup, runs `pnpm run lint`. |
| [`.github/workflows/test.yml`](../.github/workflows/test.yml) | Same setup, runs `pnpm run test`. |
| `.github/workflows/build.yml` | **Deleted** â there is no build step in a plain-JS setup. |

### 4.6 Generated file

| File | Note |
|---|---|
| `pnpm-lock.yaml` | Generated by `pnpm install`. **Commit it** â CI uses `--frozen-lockfile`, which requires the lockfile to be present and in sync. |

---

## 5. How the pieces fit together

```
              extends eslint preset
   @funtush/config  âââââââââââââââââ¶  every package (via root eslint.config.mjs)

   workspace:* links (pnpm symlinks resolve to local src/index.js):
   @funtush/shared   âââ used by ââ¶  @funtush/database, api, web, mobile
   @funtush/ui       âââ used by ââ¶  @funtush/web
   @funtush/database âââ used by ââ¶  @funtush/api
```

- **pnpm** creates the symlinks so `import { tenantKey } from "@funtush/shared"`
  resolves to the local package's `src/index.js`, not a published one.
- **Turborepo** runs `lint`/`test`/`dev` across all packages and caches results.
  There's no build ordering to enforce because nothing is compiled.

---

## 6. Packages installed

### 6.1 Root dev tooling (shared by all workspaces)

Declared in [`package.json`](../package.json) `devDependencies`. These are hoisted
to the repo root so every workspace's scripts can use them.

| Package | What it does |
|---|---|
| `turbo` | The monorepo task runner / orchestrator. |
| `vitest` | The test runner (`pnpm test`). |
| `eslint` | The linter. |
| `@eslint/js` | ESLint's official recommended rule set. |
| `globals` | Predefined global-variable lists (we use `globals.node`) for the ESLint config. |
| `prettier` | Code formatter. |
| `rimraf` | Cross-platform `rm -rf`, used by each package's `clean` script. |
| `@funtush/config` | The internal shared-config package (linked, not downloaded). |

> Note: there is **no** `typescript`, `tsx`, `@types/*`, or `typescript-eslint` â
> the project is plain JavaScript.

### 6.2 App/package-specific dependencies

| Package | Dependency | Type | Why |
|---|---|---|---|
| `@funtush/api` | `express` (^4.21.2) | runtime | The HTTP server framework. |
| `@funtush/api` | `@funtush/shared`, `@funtush/database` | runtime (`workspace:*`) | Internal libraries it consumes. |
| `@funtush/database` | `@funtush/shared` | runtime (`workspace:*`) | Uses the shared `tenantKey` helper. |
| `@funtush/web` | `@funtush/shared`, `@funtush/ui` | runtime (`workspace:*`) | Internal libraries it consumes. |
| `@funtush/mobile` | `@funtush/shared` | runtime (`workspace:*`) | Internal library it consumes. |

> `esbuild` appears transitively (used by `vitest`). pnpm asks permission before
> running its install script; that approval lives in `pnpm-workspace.yaml` under
> `allowBuilds`.

---

## 7. Install & Run

### Prerequisites
- **Node.js >= 22** (`node --version`) â needed for the built-in `--watch` flag.
- **pnpm >= 11** (`pnpm --version`) â install with `npm i -g pnpm` or `corepack enable`.

### Install everything
```bash
pnpm install
```
This installs all dependencies for every workspace at once and creates the
`workspace:*` symlinks.

### Common commands (run from the repo root)

| Command | What it does |
|---|---|
| `pnpm dev` | Run all dev processes (the API live-reloads via `node --watch`). |
| `pnpm lint` | Lint every package with ESLint. |
| `pnpm test` | Run all tests with Vitest. |
| `pnpm format` | Auto-format the repo with Prettier (`format:check` to verify only). |
| `pnpm clean` | Remove turbo caches + coverage. |

### Run just the API
```bash
# development (hot reload via Node's --watch)
pnpm --filter @funtush/api dev

# production
pnpm --filter @funtush/api start    # node src/index.js
```
Then check it:
```bash
curl http://localhost:4000/health
# {"status":"ok","service":"funtush-api"}
```
Set a custom port with the `PORT` env var (e.g. `PORT=4100`).

### Target a single package
`pnpm --filter <name> <script>` runs a script in one workspace, and
`turbo run <task> --filter=<name>` does the same through turbo. Example:
`turbo run test --filter=@funtush/shared`.

---

## 8. Notes & gotchas

- **No build step.** Node runs the `src/*.js` files directly. If a future app
  (e.g. the web frontend) needs bundling, add a `build` script + turbo task for
  just that package.
- **ESM everywhere.** Every `package.json` sets `"type": "module"`, so use
  `import`/`export` and include the `.js` extension on relative imports
  (e.g. `import { tenantKey } from "./tenant.js"`).
- **Commit `pnpm-lock.yaml`.** CI runs `pnpm install --frozen-lockfile`, which
  fails if the lockfile is missing or out of date.
- **`packageManager` pin.** It's set to `pnpm@11.5.1` (the version on the setup
  machine). If your team standardizes on another version, update that field and
  the `engines.pnpm` range together.
- **Prettier + Windows line endings.** `pnpm format:check` may flag some
  pre-existing scaffold `.md` files. That's only a CRLF-vs-LF artifact on Windows
  checkouts â the files are stored as LF in git, so CI (Linux) passes.
- **Adding a new package.** Create it under `apps/` or `packages/`, give it a
  `@funtush/*` name with `"type": "module"`, point `main`/`exports` at
  `src/index.js`, and add the standard scripts; pnpm/turbo pick it up on the next
  `pnpm install`.

---

*Companion to the Funtush Backend Intern Reference Guide. This file documents the
monorepo setup only (Phase 1 foundation); feature implementation follows the phase
roadmap in Â§17 of the guide.*
