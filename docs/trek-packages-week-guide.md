# Trek Packages — Complete Week Implementation Guide

**Branch:** `feature/ds/trek-packages`
**Scope:** Days 1–5 of the Trek Packages module — schema, package API, itinerary
builder, departure dates & slot management, and testing.
**Audience:** anyone (including a future you) who needs to understand *everything*
that was built this week, from the database tables up to the passing test suite.

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [Architecture & layering](#2-architecture--layering)
3. [Cross-cutting concepts](#3-cross-cutting-concepts-read-this-first)
4. [Day 1 — Package schema](#4-day-1--package-schema)
5. [Day 2 — Package API](#5-day-2--package-api)
6. [Day 3 — Itinerary builder](#6-day-3--itinerary-builder)
7. [Day 4 — Departure dates & slot management](#7-day-4--departure-dates--slot-management)
8. [Day 5 — Testing](#8-day-5--testing)
9. [Full API reference](#9-full-api-reference)
10. [How to run & test](#10-how-to-run--test)

---

## 1. The big picture

This week delivered the **agency-facing package management system** — the part of
Funtush that lets a trekking agency build, manage, and publish the treks it sells.
The week was sequenced so each day builds on the previous one:

| Day | Theme | Deliverable |
|---|---|---|
| 1 | Package schema | All tables created and linked |
| 2 | Package API | Agency can create, edit, publish, archive packages |
| 3 | Itinerary builder | Full itinerary management with reordering |
| 4 | Departure dates | Slot management prevents overbooking |
| 5 | Testing | All tests pass |

A **trek package** is the central content object an agency sells. It owns:

- a list of **itinerary days** (the day-by-day plan),
- a list of **departure dates** (dated slot pools trekkers book against),
- optional **add-ons** (extras with a price),
- links to shared **destinations**.

Everything is **multi-tenant**: each agency is an isolated tenant and can only ever
see or touch its own data. This rule drives almost every design decision below.

---

## 2. Architecture & layering

Every request flows through four layers. Keeping them separate is what makes the code
testable and the tenant rule enforceable.

```
HTTP request
   │
   ▼
[ Route ]        apps/api/src/routes/package.routes.ts
   │             maps URL + method → controller, attaches auth middleware
   ▼
[ Middleware ]   authenticateWithRefreshToken
   │             verifies the caller, sets req.agencyId (the tenant)
   ▼
[ Controller ]   apps/api/src/controllers/*.controller.ts
   │             reads req, calls the service, maps errors → HTTP status
   ▼
[ Service ]      apps/api/src/services/*.service.ts
   │             ALL business logic + validation + DB queries live here
   ▼
[ Prisma / DB ]  packages/database — PostgreSQL via Prisma
```

### Why this split matters

- **Controllers are thin.** They never contain business rules — they translate
  HTTP ↔ service calls and turn thrown errors into status codes.
- **Services are the brain.** They validate input, enforce tenant isolation, run
  transactions, and talk to Prisma. Because they're plain functions, they can be unit
  tested without spinning up Express or a real DB (see Day 5).
- **The tenant id (`agencyId`) is set by middleware**, not taken from the request body.
  This is the foundation of multi-tenancy.

### Authentication: `authenticateWithRefreshToken`

File: `apps/api/src/middlewares/refreshTokenAuthentication.ts`

1. Reads the `x-refresh-token` header (401 if missing).
2. Compares it (bcrypt) against stored token hashes to find the matching session.
3. Looks up the owning `agencyUser` and sets **`req.agencyId = user.agencyId`**.
4. 401 if the token is invalid or the user is gone.

After this middleware runs, every controller can trust `req.agencyId` as the
authenticated tenant. A client **cannot** override it by sending an `agencyId` in the
body — the services ignore the body for ownership and use this value.

---

## 3. Cross-cutting concepts (read this first)

These four ideas appear in every file. Understanding them once explains the whole week.

### 3.1 Multi-tenancy / tenant isolation

> An agency must never read or modify another agency's data.

Enforced **in the service layer** on every query, using one of two patterns:

- **Scoped write** — `updateMany`/`create` with `where: { id, agencyId }`. If the row
  belongs to another agency, the `where` matches nothing, `count` comes back `0`, and the
  service throws **404** ("Package not found"). We return 404, not 403, so an attacker
  can't even learn that the row exists.
- **Ownership gate** — for nested resources (itinerary days, departure dates) the
  service first calls `assertPackageOwned(agencyId, packageId)`. This does a
  `findFirst({ where: { id: packageId, agencyId } })`; if nothing matches it throws 404
  *before* any child operation runs. So you can never reach another agency's itinerary
  even if you guess a valid package id.

### 3.2 Validation

Pure functions in `apps/api/src/utils/validator.ts` check the *shape* of input and
throw a plain `Error` with a human message on the first problem. Services call the
validator **before** touching the database, so bad input never reaches Prisma. Examples:
`validatePackageInput`, `validateItineraryDayInput`, `validateDepartureDateInput`.

### 3.3 Error handling → HTTP status

Services throw `Error` objects. "Not found" errors get a `.status = 404` property; all
other (validation/business) errors have none. Every controller uses the same helper:

```ts
const errorResponse = (res, err) => {
  const e = err as Error & { status?: number };
  return res.status(e.status ?? 400).json({ success: false, message: e.message });
};
```

So: **404** for not-found/wrong-tenant, **400** for everything the service rejects,
**401** when `req.agencyId` is missing, **201** for newly created resources, **200**
otherwise.

### 3.4 Transactions

When a single logical change spans multiple writes, they run inside
`db.$transaction([...])` (or a callback) so the database either applies **all** of them
or **none**. This prevents a reader from ever seeing a half-finished state. Used for:
itinerary delete-and-renumber, itinerary reorder, and booking confirmation.

---

## 4. Day 1 — Package schema

**Goal:** create and link every table the module needs.
**File:** `packages/database/prisma/schema.prisma` (PostgreSQL via Prisma).

### Enums

```prisma
enum PackageStatus   { DRAFT  PUBLISHED  ARCHIVED }
enum DepartureStatus { AVAILABLE  FULL  GUARANTEED }
enum TrekDifficulty  { EASY  MODERATE  CHALLENGING  DIFFICULT }
```

### Models and their key fields

**`TrekPackage`** — the central object.

| Field | Notes |
|---|---|
| `id` | uuid PK |
| `agencyId` | the tenant owner; indexed; `onDelete: Cascade` from Agency |
| `title` | |
| `slug` | **`@unique`** — URL-friendly, auto-derived from title |
| `description` | optional |
| `durationDays`, `pricePerPerson` (Decimal 10,2), `difficulty`, `maxGroupSize` | |
| `status` | `PackageStatus`, **defaults to `DRAFT`** |
| `createdAt`, `updatedAt` | timestamps |

Relations: `itineraries[]`, `departureDates[]`, `addOns[]`, `destinations[]` (M:N),
`bookings[]`.

**`TrekDestination`** — a place (e.g. "Everest Region"). Belongs to an agency; linked to
packages many-to-many (`packages[]`). Fields: `name`, `region`, `altitudeM`, `bestSeason`.

**`TrekItinerary`** — one day of the plan. `packageId`, `dayNumber` (1-based), `location`,
`description`, `altitudeM`, `photos String[]`. Indexed on `packageId`.

**`TrekDepartureDate`** — a dated, bookable slot pool. `packageId`, `startDate`,
`maxSlots` (capacity), `bookedSlots` (default 0), `status` (default `AVAILABLE`).

**`TrekAddOn`** — an optional extra. `name`, `price` (Decimal), `perPerson` boolean.

**`Booking`** — created when a trekker inquires. Holds `groupSize`, `totalPrice`,
`status` (`BookingStatus`, default `INQUIRY`), trekker contact fields, and FKs to package
+ departure date. Indexed on `(agencyId, status)`.

### Relationships summary

```
Agency 1───* TrekPackage *───* TrekDestination
                  │
                  ├──* TrekItinerary
                  ├──* TrekDepartureDate ───* Booking
                  └──* TrekAddOn
```

**Deliverable met:** all tables created and linked.

---

## 5. Day 2 — Package API

**Goal:** an agency can create, edit, list, publish, duplicate, and archive packages.
**Files:** `package.controller.ts`, `package.service.ts`, `package.routes.ts`.

### The package status lifecycle

```
          create
            │
            ▼
        ┌────────┐   publish (if complete)   ┌───────────┐
        │ DRAFT  │ ────────────────────────► │ PUBLISHED │
        └────────┘                           └───────────┘
            │                                      │
            │ archive                       archive│
            ▼                                      ▼
                         ┌──────────┐
                         │ ARCHIVED │  (cannot be published again)
                         └──────────┘
```

`status` is **never** editable through the normal edit endpoint — it only moves via the
dedicated `publish` and `archive` actions. This keeps the lifecycle controlled.

### Endpoint-by-endpoint

**POST `/agencies/packages` — create** (`createPackageService`)
1. `validatePackageInput(data)` — title required, durationDays/maxGroupSize positive ints,
   pricePerPerson ≥ 0, difficulty must be a valid enum value.
2. Generates a unique slug from the title (see below).
3. Creates the row with `agencyId` from the token and **no** status → defaults to `DRAFT`.
→ **201** with the new package.

**Slug generation** (`generatePackageSlug`): lowercases the title, strips non-alphanumerics,
replaces spaces with `-`. Because `slug` is `@unique`, it loops appending `-2`, `-3`, …
until it finds a free slug. So "Everest Base Camp" → `everest-base-camp`, and a second
one becomes `everest-base-camp-2`.

**PATCH `/agencies/packages/:id` — edit** (`updatePackageService`)
- Builds `updateData` from **only the fields actually supplied** (partial update).
- Throws "No fields provided to update" if the body is empty.
- `updateMany({ where: { id, agencyId }, data })` — **tenant-scoped**. `count === 0` → 404.
- `status` is deliberately excluded from editable fields.

**GET `/agencies/packages?status=&destination=` — list** (`listPackagesService`)
- Always starts `where = { agencyId }`.
- Optional `status` filter and `destination` filter (M:N: `destinations: { some: { name:
  { equals, mode: "insensitive" } } }`).
- Ordered by `createdAt desc`.

**POST `/agencies/packages/:id/publish` — publish** (`publishPackageService`)
1. Fetches the package scoped to the tenant, **including** `itineraries` and
   `departureDates`.
2. Refuses to publish an `ARCHIVED` package.
3. **Completeness check** — collects *all* missing requirements (not just the first):
   title, description, a price > 0, ≥ 1 itinerary day, ≥ 1 departure date. If any are
   missing it throws one message listing them → **400**.
4. Otherwise flips `status` to `PUBLISHED`.

**POST `/agencies/packages/:id/duplicate` — clone** (`duplicatePackageService`)
- Fetches the source (tenant-scoped) with itineraries, dates, add-ons, destinations.
- Creates a new package via Prisma **nested writes** (parent + children in one write):
  - title `"Copy of …"`, a fresh unique slug;
  - **always `DRAFT`**, even if the source was published;
  - itineraries and add-ons copied;
  - departure dates copied but with **`bookedSlots: 0` and `status: AVAILABLE`** — you must
    never copy someone's bookings into a clone;
  - destinations **connected** (shared M:N), not duplicated.
→ **201**.

**DELETE `/agencies/packages/:id` — archive (soft delete)** (`archivePackageService`)
- `updateMany({ where: { id, agencyId }, data: { status: "ARCHIVED" } })`. `count === 0` → 404.
- It's a *soft* delete: the row stays, only the status changes.

**Deliverable met:** agency can create, edit, publish, and archive packages.

---

## 6. Day 3 — Itinerary builder

**Goal:** full day-by-day itinerary management, including reordering.
**Files:** `itinerary.controller.ts`, `itinerary.service.ts`.

A package's itinerary is a list of days numbered **contiguously 1..N**. The route param
`:day` refers to that `day_number`, not the row id — it reads naturally ("delete day 3").

> **Route ordering gotcha:** `/itinerary/reorder` is declared **before**
> `/itinerary/:day` so Express doesn't treat the literal word "reorder" as a day number.

Every operation first calls `assertPackageOwned(agencyId, packageId)` for tenant isolation.

**POST `…/itinerary` — add a day** (`addItineraryDayService`)
- Validates input (`dayNumber` required positive int; other fields optional & typed).
- Rejects a **duplicate day number** with a clear message instead of silently creating a
  second "Day 3".
- Creates the row.

**PUT `…/itinerary/:day` — update day content** (`updateItineraryDayService`)
- Partial update of content fields only (`location`, `description`, `altitudeM`, `photos`).
- **`dayNumber` is not editable here** — moving days is the reorder endpoint's job.
- `updateMany({ where: { packageId, dayNumber } })`; `count === 0` → 404.

**DELETE `…/itinerary/:day` — remove a day** (`deleteItineraryDayService`)
- Confirms the day exists (else 404).
- In **one transaction**: deletes the day, then shifts every later day down by one
  (`dayNumber: { gt: N }` → `decrement: 1`) so numbers stay contiguous. A reader never
  sees a half-renumbered itinerary.

**PATCH `…/itinerary/reorder` — reorder** (`reorderItineraryService`)
- Body: `{ order: string[] }` — itinerary **row ids** in the desired sequence.
- Validates the submitted list is an **exact permutation** of the package's days:
  non-empty array of strings, same length, every id belongs to the package, no duplicates,
  no foreign ids. Any violation → a specific error.
- In a transaction, sets each row's `dayNumber = index + 1`.

**Deliverable met:** full itinerary management with reordering.

---

## 7. Day 4 — Departure dates & slot management

**Goal:** manage dated slot pools and **prevent overbooking**.
**Files:** `departureDate.controller.ts`, `departureDate.service.ts`, plus the slot guard
used by the booking flow (`booking.service.ts`).

### The slot model

- `maxSlots` — total head-count capacity for that date.
- `bookedSlots` — seats already taken by **confirmed** bookings (starts at 0).
- A date is **`FULL`** once `bookedSlots >= maxSlots`.
- **`GUARANTEED`** is a deliberate agency promise (the trek will run); the system never
  silently downgrades it, but it *will* promote it to `FULL` when it sells out.

Helper `assertPackageOwned` (tenant gate) + `getOwnedDeparture(packageId, dateId)` (confirms
the date belongs to that package) guard every operation.

**POST `…/dates` — add** (`addDepartureDateService`)
- Validates `startDate` (must parse and **not be in the past**) and `maxSlots` (positive int).
- Creates with `bookedSlots: 0` and status `AVAILABLE` (or honours an explicit `GUARANTEED`).

**PATCH `…/dates/:dateId` — update status / slots** (`updateDepartureDateService`)
Two business rules protect confirmed trekkers:
- `maxSlots` **cannot drop below `bookedSlots`** — that would retroactively overbook.
- You **cannot mark a sold-out date `AVAILABLE`/`GUARANTEED`** — that would re-open
  overbooking.
- If the caller doesn't set a status explicitly, it's **auto-derived** (`deriveStatus`):
  `bookedSlots >= maxSlots` → `FULL`; a `FULL` date whose capacity reopened → `AVAILABLE`;
  otherwise unchanged.

**DELETE `…/dates/:dateId` — remove** (`deleteDepartureDateService`)
- Blocks deletion when **any booking** references the date (clear message instead of a raw
  Postgres FK error). Suggests marking it `FULL` instead.

### Preventing overbooking — the two guard points

This is the day's headline deliverable. A date that's full must never accept a new inquiry,
and two confirmations racing for the last seats must not both succeed.

**Guard 1 — inquiry submission** (`booking.service.ts → submitInquiry`):
before sending the OTP, it checks the departure date:
```ts
if (departure.status === "FULL") throw new Error("This departure date is full");
const available = departure.maxSlots - departure.bookedSlots;
if (groupSize > available) throw new Error(`Only ${available} slot(s) available …`);
```
The inquiry fails *fast* — no OTP, no side effects. (A second check repeats at OTP
verification, since slots may fill during the 15-minute OTP window.)

**Guard 2 — confirmation, under a transaction** (`confirmSlotsForBooking`):
when an agency accepts a booking, this runs inside the booking transaction. It re-reads the
date, re-checks `FULL`/capacity, then increments `bookedSlots` and flips to `FULL` on
sell-out. Because it's inside the transaction, two confirmations can't both grab the last seat.

**Deliverable met:** slot management prevents overbooking.

---

## 8. Day 5 — Testing

**Goal:** prove every behavior above with an automated test suite that passes.
**Files:** `apps/api/test/{package,itinerary,departureDate,booking-slots}.test.ts`.
**Full report:** see `docs/day5-testing-report.md`.

### Approach — unit tests with a mocked database

- **Framework:** Vitest (`pnpm --filter @funtush/api test`).
- Tests target the **service layer** (where the logic lives) and **mock Prisma** so no real
  database is needed — fast, deterministic, and CI-friendly (CI has no DB).
- A *mock* replaces `@funtush/database` with a fake whose Prisma methods are spy functions
  (`vi.fn()`). Each spy (a) returns whatever we tell it (`mockResolvedValue`) to simulate
  DB results, and (b) records its calls so we can assert the service queried correctly —
  e.g. that it scoped by `agencyId` (tenant isolation).

> **Key detail:** the four services import from `@funtush/database` (where `db === prisma`),
> so the mock factory returns one fake `client` under both the `db` and `prisma` keys (plus
> `redis` for the booking test). The booking test also mocks email, push, and OTP helpers.

### What's covered (46 tests)

| File | Tests | Highlights |
|---|---:|---|
| `package.test.ts` | 16 | create forces DRAFT + agency-scoped; edit 404s for foreign agency; publish lists all missing fields; duplicate clones as DRAFT with reset slots; archive |
| `itinerary.test.ts` | 13 | add rejects duplicate day; delete renumbers in a transaction; reorder rejects missing/extra/duplicate/foreign ids |
| `departureDate.test.ts` | 12 | can't shrink below booked; can't reopen a sold-out date; FULL auto-derivation; transactional slot booking |
| `booking-slots.test.ts` | 5 | FULL date rejected with **no OTP sent**; exact remaining-seats boundary allowed |

### Result

```
Test Files  14 passed (14)
     Tests  157 passed (157)
```

46 new tests pass; the 111 pre-existing tests still pass (no regressions). The
`Redis error, failing open` / `MongoDB down` lines in the output are intentional logs from
other fail-safe tests, not failures.

**Deliverable met:** all tests pass.

---

## 9. Full API reference

All routes are mounted at `/` in `apps/api/src/index.ts` and require the
`x-refresh-token` header (sets the tenant `agencyId`).

| Method | Path | Action | Success |
|---|---|---|---|
| POST | `/agencies/packages` | Create package (DRAFT) | 201 |
| GET | `/agencies/packages?status=&destination=` | List own packages | 200 |
| PATCH | `/agencies/packages/:id` | Edit package fields | 200 |
| DELETE | `/agencies/packages/:id` | Archive (soft delete) | 200 |
| POST | `/agencies/packages/:id/publish` | Publish if complete | 200 |
| POST | `/agencies/packages/:id/duplicate` | Clone as DRAFT | 201 |
| POST | `/agencies/packages/:id/itinerary` | Add itinerary day | 201 |
| PATCH | `/agencies/packages/:id/itinerary/reorder` | Reorder days | 200 |
| PUT | `/agencies/packages/:id/itinerary/:day` | Update day content | 200 |
| DELETE | `/agencies/packages/:id/itinerary/:day` | Delete day + renumber | 200 |
| POST | `/agencies/packages/:id/dates` | Add departure date | 201 |
| PATCH | `/agencies/packages/:id/dates/:dateId` | Update status / slots | 200 |
| DELETE | `/agencies/packages/:id/dates/:dateId` | Remove date (if no bookings) | 200 |

Common error codes: **401** (no/invalid token), **404** (not found or wrong tenant),
**400** (validation/business rule), **201/200** on success.

---

## 10. How to run & test

```bash
# install (from repo root)
pnpm install

# run the API in dev
pnpm --filter @funtush/api dev

# run the full API test suite
pnpm --filter @funtush/api test

# run a single test file while iterating
pnpm --filter @funtush/api exec vitest run test/package.test.ts

# the monorepo-wide gate CI uses
pnpm test
```

### Known follow-ups (not part of this week)

- `tsc` reports type errors in some **other** service files (`booking.service.ts`,
  `admin.service.ts`, …) because the **generated Prisma client is stale** relative to the
  schema. Regenerate with `pnpm --filter @funtush/database exec prisma generate`. This
  doesn't affect the tests (Vitest runs via esbuild, which strips types).
- Route-level tests with `supertest` could complement these service unit tests by asserting
  the HTTP status mapping (e.g. a full-slots error → 409/400).

---

*Generated as the week-end reference for the `feature/ds/trek-packages` work
(Days 1–5). Source of truth is the code in `apps/api/src` and
`packages/database/prisma/schema.prisma`.*
