# Day 5 — Testing: Implementation Report

**Date:** 2026-06-14
**Scope:** The Day 5 deliverable from the project plan — *Testing* — covering the
package, itinerary, departure-date, and booking-inquiry features built on Days 2–4.

> **A note on "Day 4" vs "Day 5".** The task image is labelled **DAY 5 — Testing**,
> and the codebase agrees: `itinerary.service.ts` is commented *Day 3* and
> `departureDate.service.ts` is commented *Day 4*. So "Day 4" was the departure-date
> feature (already built); this report covers the **Day 5 testing task** shown in the
> image. Nothing in the feature code was changed — Day 5 only adds tests.

---

## 1. What "testing" means here (from very basic)

A **test** is a small program that calls your real code with known inputs and then
**asserts** ("checks") that the output is what you expect. If the code ever changes
and breaks that expectation, the test fails — so tests are an automatic alarm that
catches mistakes before users do.

This project uses **Vitest**, a test runner. You write files ending in `.test.ts`;
Vitest finds them, runs every `it(...)` block, and reports pass/fail. The three words
you'll see in every test:

| Word | Meaning |
|---|---|
| `describe(name, fn)` | Groups related tests under a heading. |
| `it(name, fn)` | One individual test case ("it should do X"). |
| `expect(value).toBe(...)` | The assertion — the actual check. |

### Unit tests vs. mocking the database

Our services talk to PostgreSQL through **Prisma**. We do **not** want tests to hit a
real database, because:

- CI (GitHub Actions) has no database running, so real-DB tests couldn't pass there.
- A real DB makes tests slow and flaky (network, state left over between runs).

So we use **mocking**. A *mock* is a fake stand-in for a real thing. We replace the
entire `@funtush/database` module with a fake whose Prisma methods are **spy
functions** (`vi.fn()`). A spy does two jobs:

1. It **returns whatever value we tell it to** (`mockResolvedValue(...)`) — so we can
   simulate "the DB found this package" or "the DB found nothing".
2. It **records how it was called** (`.mock.calls`) — so we can assert "the service
   asked Prisma to filter by `agencyId`", which is how we prove tenant isolation.

This is exactly the style the repo already used in `test/kyc.test.ts`; the new tests
follow the same convention.

---

## 2. The one subtlety that makes the mocks work

`vi.mock("module")` only intercepts a module if it matches the **exact import string
the service uses**. There are two Prisma paths in this repo:

- `kyc.service.ts` imports from `../src/packages/database/prisma`.
- **Our four target services** import from `@funtush/database`:
  - `package`, `itinerary`, `departureDate` use `import { db } from "@funtush/database"`
  - `booking` uses `import { prisma, redis } from "@funtush/database"`

In the real module, `db` and `prisma` are the **same object** (`export const db = prisma`
in `packages/database/src/db.ts`). So every mock factory returns one fake `client`
object under **both** the `db` and `prisma` keys, and `redis` where needed. Getting this
right is what stops a test from accidentally booting a real Prisma client.

```ts
vi.mock("@funtush/database", () => {
  const client = { trekPackage: { findUnique: vi.fn(), /* ...only methods used */ } };
  return { db: client, prisma: client };   // both names → same fake
});
```

`vi.mock` is **hoisted** above the imports by Vitest, so the service receives the fake.

---

## 3. The files added

All four live in `apps/api/test/` (the repo's integration-test folder):

| File | Tests | Covers (image bullet) |
|---|---:|---|
| `package.test.ts` | 16 | Create / edit / publish / archive (+ duplicate) package |
| `itinerary.test.ts` | 13 | Itinerary day CRUD and reorder |
| `departureDate.test.ts` | 12 | Departure date management & slot logic |
| `booking-slots.test.ts` | 5 | Full slots prevent inquiry |
| **Total** | **46** | |

No application code was modified. The services already implemented every behavior;
Day 5 only proves them.

---

## 4. What each file checks, and why

### 4.1 `package.test.ts` — package lifecycle

The lifecycle is **DRAFT → PUBLISHED → ARCHIVED**, plus duplicate.

- **create**: new packages are forced to `DRAFT`; `agencyId` is taken from the
  authenticated caller (the argument), **never** from the request body — this is the
  core multi-tenancy rule. Also: invalid input is rejected before any DB write, and a
  slug that collides gets a `-2` suffix.
- **edit (`update`)**: only the fields you send are changed; the query is scoped by
  **both** `id` **and** `agencyId`. The decisive isolation test: agency B editing
  agency A's package gets a **404** (Prisma's `updateMany` returns `count: 0`). `status`
  can never be changed through edit.
- **list**: every query is scoped to the caller's `agencyId`; `status`/`destination`
  filters pass through.
- **publish**: a package can only go live if it's complete. The richest test asserts
  that publishing an empty package reports **all** missing requirements at once (title,
  description, price, ≥1 itinerary day, ≥1 departure date), and that an `ARCHIVED`
  package can't be published.
- **duplicate**: the clone is always `DRAFT` (even from a `PUBLISHED` source), its
  departure dates reset to `bookedSlots: 0` / `AVAILABLE` (you must never copy someone
  else's bookings into a new package), and destinations are *connected*, not duplicated.
- **archive**: sets `ARCHIVED`, scoped by `id` + `agencyId`; 404 for a foreign agency.

### 4.2 `itinerary.test.ts` — day CRUD and reorder

Every itinerary operation first calls `assertPackageOwned` (a `trekPackage.findFirst`),
so the tests drive that mock to "owned" or "not owned" to exercise isolation.

- **add**: creates a day when the number is free; rejects a **duplicate day number**;
  404 when the package belongs to another agency; rejects invalid input before any DB
  call.
- **update**: changes only content fields; `dayNumber` is *not* editable here
  (re-numbering is the reorder endpoint's job); 404 when the day doesn't exist.
- **delete**: the interesting one — after deleting day *N*, all later days shift down by
  one so numbers stay contiguous `1..N`, and the delete + renumber happen inside a
  single `$transaction` (asserted). 404 + no transaction when the day is missing.
- **reorder**: the body is a list of itinerary IDs in the new order; each row's
  `dayNumber` becomes its 1-based position. The valuable tests are the **rejections**:
  an order that's missing a day, contains an ID from another package, has a duplicate,
  or isn't a non-empty array — all throw, protecting against a corrupt itinerary.

### 4.3 `departureDate.test.ts` — slots & overbooking guard

`maxSlots` is total capacity; `bookedSlots` is seats already sold; a date flips to
`FULL` when they're equal.

- **add**: 0 booked slots, defaults to `AVAILABLE`, honours an explicit `GUARANTEED`,
  and rejects a start date in the past.
- **update**: refuses to drop `maxSlots` below `bookedSlots` (that would retroactively
  overbook); refuses to mark a sold-out date `AVAILABLE`; auto-derives `FULL` when
  capacity meets the booked count, and reopens `FULL → AVAILABLE` when capacity grows.
- **delete**: blocked when bookings reference the date (clear message instead of a raw
  FK error); succeeds at 0 bookings.
- **confirmSlotsForBooking**: the transactional booking step — books the seats and flips
  to `FULL` on sell-out; throws when already `FULL`; throws when the group exceeds the
  remaining seats. This is the last line of defence against a race between two
  confirmations.

### 4.4 `booking-slots.test.ts` — "full slots prevent inquiry"

This is the bullet named explicitly in the image. It tests `submitInquiry`, mocking
Prisma, Redis, email, push, and OTP so no real services are touched.

- A **FULL** departure date is rejected, **and no OTP email is sent** — the request
  fails fast, before any side effect.
- A group larger than the remaining slots is rejected with the exact "Only N slot(s)
  available" message.
- **Boundary test**: a group that *exactly* fills the remaining seats is allowed and the
  OTP is sent — this catches off-by-one bugs the obvious cases miss.
- Inquiries against an unpublished package, or a departure belonging to a different
  package, are rejected.

---

## 5. How to run it

```bash
# just the new files, while iterating
pnpm --filter @funtush/api exec vitest run test/package.test.ts

# the whole API suite
pnpm --filter @funtush/api test

# the monorepo gate CI uses
pnpm test
```

---

## 6. Result — deliverable status

The image's deliverable is **"All tests pass."**

```
Test Files  14 passed (14)
     Tests  157 passed (157)
```

- **46** new tests (the 4 files above) — all pass.
- **111** pre-existing tests — still pass (no regressions).
- The `stderr` lines seen during the run (`Redis error, failing open`, `MongoDB down`)
  are **intentional** logs from pre-existing fail-safe tests, not failures.

| Image checklist item | Status |
|---|---|
| Test create/edit/publish/archive package | ✅ covered by `package.test.ts` |
| Test itinerary day CRUD and reorder | ✅ covered by `itinerary.test.ts` |
| Test departure date management | ✅ covered by `departureDate.test.ts` |
| Test full slots prevent inquiry | ✅ covered by `booking-slots.test.ts` |
| **Deliverable: All tests pass** | ✅ 157/157 |

---

## 7. Suggested next steps (optional)

- **Coverage report**: add `vitest run --coverage` to see untested branches.
- **Controller/route-level tests**: these are service-layer unit tests. A future layer
  could use `supertest` against the Express app to test status-code mapping (e.g. that a
  full-slots error becomes HTTP 409).
- **A real-DB integration suite** (gated behind a separate command with a disposable
  Postgres) would complement — not replace — these fast unit tests.
