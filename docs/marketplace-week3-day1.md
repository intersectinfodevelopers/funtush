# Marketplace — Week 3 · Day 1: Search Index Setup

**Branch:** `feature/ds/trek-packages` (Week 3 work: Central Marketplace)
**Developer:** Dipesh Singh
**Scope:** Day 1 of the marketplace module — install & configure Meilisearch,
create the `packages` and `agencies` search indexes, keep them in sync when a
package is published/archived, and enable typo tolerance.

> **Deliverable (from the plan):** *Search index live, typo tolerance enabled.*

---

## 1. The big picture — why a separate search engine at all?

Up to now, every "list" endpoint (e.g. `GET /agencies/packages`) reads straight
from **PostgreSQL**. That's perfect for an agency managing *its own* data, but
the public marketplace is a different problem:

- A traveler types **"everest"** and expects results ranked by relevance.
- They misspell it **"everst"** and still expect Everest treks.
- It has to come back in **under 100 ms** across *all* agencies.

PostgreSQL is not built for fuzzy, typo-tolerant, relevance-ranked full-text
search at that speed. So the backend guide (§14) makes a hard rule:

> **Search is answered ONLY by Meilisearch, never by Postgres.**

Meilisearch is a small, fast search engine. We feed it a copy of each package
and agency (a "document"), and it builds an inverted index optimized for search.
Day 1 is about **building those indexes and keeping them fresh** — the actual
search *endpoints* are Day 2.

Think of it like a library:
- **PostgreSQL** = the storage room where the real books live (source of truth).
- **Meilisearch** = the card catalog at the front desk — a searchable copy that
  points back to the books. We keep the catalog in sync whenever a book is
  published or removed.

---

## 2. What I built today (files)

| File | What it is |
|---|---|
| `apps/api/src/lib/meilisearch.ts` | The Meilisearch **client** — one shared connection per process. |
| `apps/api/src/services/search.service.ts` | The **only** module that talks to Meilisearch: index config, document mappers, sync/remove helpers, full reindex. |
| `apps/api/src/services/search.service.test.ts` | Unit tests (11) for the mappers + index config + sync helpers. |
| `apps/api/src/scripts/reindexSearch.ts` | One-off script to rebuild the indexes from the DB. |
| `apps/api/src/services/package.service.ts` | **Edited** — publish now syncs to the index; archive removes from it. |
| `apps/api/src/index.ts` | **Edited** — indexes are configured on server boot. |
| `.env.example` | **Edited** — added `MEILI_HOST` and `MEILI_MASTER_KEY`. |

---

## 3. The client (`lib/meilisearch.ts`)

Just like `lib/redis.ts`, we want **one** Meilisearch connection for the whole
process, not a new one per request. The config comes from environment variables:

```
MEILI_HOST="http://localhost:7700"   # where Meilisearch runs
MEILI_MASTER_KEY=""                   # admin key (optional in dev, required in prod)
```

Two design choices worth knowing:

1. **Lazy construction (`getMeili()`).** The client is only created the first
   time it's actually needed — not when the file is imported. *Why?* So that a
   unit test importing the package service (which imports the search service)
   doesn't accidentally open a network connection. Tests stay fast and offline.

2. **`isSearchEnabled()`.** Every write helper checks this first. If Meilisearch
   isn't configured, the functions **log and return** instead of throwing. The
   marketplace search box can be down and the rest of the API still works.

---

## 4. The two indexes (`configureIndexes()`)

An index in Meilisearch is like a table, but you must tell it **which fields do
what**. We create two:

### `packages` index
| Setting | Fields | Meaning |
|---|---|---|
| **searchable** | `title`, `description`, `destination`, `agencyName` | fields the text query matches against (earlier = higher weight) |
| **filterable** | `difficulty`, `price`, `duration`, `season`, `altitude`, `status`, `agencyId` | fields you can narrow by (`price < 1500`) |
| **sortable** | `price`, `duration`, `altitude`, `createdAt` | fields you can order by |

### `agencies` index
| Setting | Fields |
|---|---|
| **searchable** | `name`, `description`, `destinations` |
| **filterable** | `tier`, `region`, `rating`, `status` |
| **sortable** | `rating` |

`configureIndexes()` is **idempotent** — safe to run on every boot. Creating an
index that already exists is a harmless no-op, and re-applying settings just
overwrites them with the same values.

### Typo tolerance — the headline feature

```ts
typoTolerance: {
  enabled: true,
  minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
}
```

This is what turns **"Everst" → "Everest"** and **"Anapurna" → "Annapurna"**.
`minWordSizeForTypos` says: a word of ≥4 letters may match with 1 typo, ≥8
letters with 2 typos. Meilisearch enables typo tolerance by default — we set it
**explicitly** so the behavior is documented in code and can't silently change
if a server default changes.

---

## 5. Document mappers — DB row → search document

Meilisearch stores flat JSON. Our Postgres rows have **relations** (a package
links to an agency, to destinations, to itinerary days). The mappers flatten
those into a single document.

`toPackageDocument()` highlights:
- `agencyName` ← pulled from the related agency (so you can search by agency).
- `destination` / `season` ← arrays flattened from the linked destinations
  (seasons de-duplicated, `null`s dropped).
- `altitude` ← the **highest** altitude across destinations *and* itinerary days.
- `price` ← Prisma stores money as a `Decimal` (which serializes as a string),
  so we `Number(...)` it — otherwise range filters wouldn't work numerically.
- `createdAt` ← converted to a unix timestamp (a number Meili can sort on).

`toAgencyDocument()` highlights:
- `region` ← the profile's `regions` is a JSON column; we normalize it to a
  `string[]` whether it was stored as an array, a single string, or null.
- `rating` ← hard-coded to `0` for now. The **review system** (also Week 3)
  doesn't exist yet, so there are no ratings to read. This is a deliberate
  placeholder, not a bug.

Keeping the mappers as **pure functions** (row in → document out, no side
effects) is why they're trivial to unit-test without a database.

---

## 6. Keeping the index in sync

The plan says: *"when an agency publishes a package, the index updates within 5
seconds."* Here's how:

- **On publish** (`publishPackageService`): after the DB flips status to
  `PUBLISHED`, we call `indexPackage(id)` and `indexAgency(agencyId)`.
- **On archive** (`archivePackageService`): we call `removePackage(id)` so an
  archived trek disappears from the public marketplace.

Both are called with `void` — meaning **fire-and-forget**:

```ts
void indexPackage(published.id);
```

*Why fire-and-forget?* Indexing talks to a separate service over the network.
If we `await` it, the agency's "Publish" button would hang on Meilisearch, and
if Meilisearch were down the publish would *fail*. Publishing to our own
database is the important part; updating the search catalog is a background
follow-up. The helpers also wrap everything in `try/catch`, so a search failure
can never bubble up and break the publish request.

Only `PUBLISHED` packages ever reach the index — drafts and archived packages
must never appear in public search.

---

## 7. Bootstrap & repair (`reindexAll` + the script)

When you first turn Meilisearch on, the index is empty even though the DB is
full. `reindexAll()` rebuilds both indexes from scratch: it configures them,
loads every `PUBLISHED` package and every agency, and pushes them in bulk. Run
it any time the index drifts from the database:

```bash
pnpm --filter @funtush/api search:reindex
```

On normal server startup, `index.ts` calls `configureIndexes()` so the indexes
and their settings always exist (it does **not** bulk-reindex on every boot —
that's what the script is for).

---

## 8. How to run it locally

1. **Start Meilisearch** (Docker is easiest):
   ```bash
   docker run -p 7700:7700 getmeili/meilisearch:latest
   ```
2. Copy `.env.example` → `.env` and set `MEILI_HOST=http://localhost:7700`.
3. Start the API: `pnpm --filter @funtush/api dev`. You'll see
   `[search] Meilisearch indexes configured (packages, agencies)`.
4. Publish a package (Week 2 endpoint) → it appears in the `packages` index.
5. Backfill existing data once: `pnpm --filter @funtush/api search:reindex`.

If `MEILI_HOST` is unset, the API runs fine — search helpers just log and skip.

---

## 9. Tests

`search.service.test.ts` (11 tests, all passing) covers:
- **Mappers**: type coercion (Decimal→number, Date→unix), highest-altitude
  logic, season de-duplication, null handling, JSON-region normalization.
- **`configureIndexes`**: asserts the correct searchable/filterable attributes
  and that typo tolerance is enabled on both indexes.
- **Sync helpers**: `indexPackage` adds the mapped document, no-ops when the
  package is missing, and `removePackage` deletes by id.

The Meilisearch client and the DB are **mocked**, so the tests are fast and need
no running services. Full suite: **193 tests pass**.

---

## 10. What's next (Day 2)

Today built the *index* and the *sync*. Day 2 builds the **search API** on top:
`GET /marketplace/packages?q=everest&difficulty=moderate&price_max=1500`, with
pagination, relevance ranking, and tier-based visibility.
