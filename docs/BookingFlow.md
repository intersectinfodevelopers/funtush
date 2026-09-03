# Booking Flow

**Role:** Authentication & JWT

## Implemented

- Trekker inquiry submission with OTP verification
- Booking creation, add-on snapshotting, and coupon application
- Agency accept / reject / propose alternative date actions
- Atomic slot reservation and release (departure-date capacity tracking)
- Payment link generation (48-hour expiry, hardcoded)
- Multi-gateway payment webhooks (Stripe, Khalti, eSewa, ConnectIPS) with signature verification and idempotency
- Post-payment agency confirmation, guide assignment, check-in, check-out
- Booking confirmation PDF generation and email delivery
- Automatic cancellation of unpaid bookings past the payment window (cron)


## 1. API Documentation

### 1.1 Submit Inquiry

**Method / Path:** `POST /bookings/inquiry`
**Auth required:** No

Validates the package, agency status, departure-date availability, add-ons, and optional coupon, then generates and emails a 6-digit OTP. Inquiry data and OTP are held in Redis (not yet persisted to the database).

**Request Body**

```json
{
  "packageId": "pkgid",
  "departureDateId": "dateid",
  "groupSize": 2,
  "addOns": [{ "addOnId": "addon-id", "quantity": 1 }],
  "trekkerName": "Jane Doe",
  "trekkerEmail": "jane@example.com",
  "trekkerPhone": "+9779800000000",
  "trekkerCountry": "US",
  "specialRequests": "Vegetarian meals",
  "couponCode": "SUMMER10"
}
```

**Required:** `packageId`, `departureDateId`, `groupSize`, `trekkerName`, `trekkerEmail`, `trekkerPhone`
**Optional:** `addOns`, `trekkerCountry`, `specialRequests`, `couponCode`

**Response Example (success, 202)**

```json
{
  "success": true,
  "data": {
    "sessionToken": "a1b2c3...",
    "expiresInSeconds": 900,
    "message": "OTP sent to your email. Please verify to complete your inquiry."
  }
}
```

| Status Code | Meaning |
|---|---|
| 202 | OTP generated and sent |
| 400 | Validation failure (invalid package, invalid add-ons, invalid coupon, etc.) |
| 409 | Package/departure date unavailable — thrown message contains "full" or "available" |

**Runtime checks enforced before an OTP is issued:**

- Package must exist and have `status = PUBLISHED`; its agency must not be `LOCKED` or `SUSPENDED`
- Departure date must belong to the package and not be `FULL`
- `groupSize` must not exceed `maxSlots - bookedSlots`
- Every `addOnId` must belong to the requested package
- If `couponCode` is present, it's validated and applied via `validateAndApplyCoupon`


### 1.2 Verify Inquiry OTP

**Method / Path:** `POST /bookings/inquiry/verify-otp`
**Auth required:** No

Confirms the OTP, re-checks slot availability (in case it changed during the 15-minute window), then persists the `Booking` and `BookingAddOn` records with status `INQUIRY`.

**Request Body**

```json
{ "sessionToken": "a1b2c3...", "otp": "123456" }
```

Both fields required.

**Response Example (success, 201)**

```json
{
  "success": true,
  "data": {
    "bookingId": "booking-id",
    "status": "INQUIRY",
    "message": "Your inquiry has been submitted. The agency will confirm within 24 hours."
  }
}
```

| Status Code | Meaning |
|---|---|
| 201 | Booking created |
| 400 | Missing `sessionToken`/`otp`, expired/invalid session, incorrect OTP |
| 500 | Unexpected failure (any other thrown error) |


### 1.3 List Agency Bookings

**Method / Path:** `GET /agencies/me/bookings`
**Auth required:** Yes — `AGENCY_ADMIN`

**Query params:** `status` (optional, filters by `BookingStatus`), `page` (default 1), `limit` (default 20)

**Response Example (success, 200)**

```json
{
  "success": true,
  "data": {
    "bookings": [ /* booking objects with package/departureDate/addOns */ ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

| Status Code | Meaning |
|---|---|
| 200 | Bookings returned |
| 500 | Unexpected failure |


### 1.4 Get Booking Detail

**Method / Path:** `GET /agencies/me/bookings/:id`
**Auth required:** Yes — `AGENCY_ADMIN`

Returns full booking detail including `package`, `departureDate`, `addOns`, and `paymentLink`. Returns "not found" if the booking doesn't exist or belongs to a different agency (agency scoping is enforced, not just an ownership check after fetch).

| Status Code | Meaning |
|---|---|
| 200 | Booking found |
| 404 | Booking not found or not owned by the requesting agency |
| 400 | Any other error |


### 1.5 Accept Booking

**Method / Path:** `PATCH /agencies/me/bookings/:id/accept`
**Auth required:** Yes — `AGENCY_ADMIN`

Only valid from `INQUIRY`. This is where slot capacity is actually reserved (not at payment time). Runs atomically in one transaction:

- `confirmSlotsForBooking` — re-checks capacity and increments `bookedSlots`; flips the departure date to `FULL` if this booking fills it
- Booking status → `PAYMENT_PENDING`
- `PaymentLink` created with a 48-hour expiry (hardcoded, not env-configurable)

**Response Example (success, 200)**

```json
{
  "success": true,
  "data": {
    "bookingId": "booking-id",
    "status": "PAYMENT_PENDING",
    "paymentUrl": "https://app.funtush.com/pay/<urlToken>",
    "expiresAt": "2026-08-31T12:40:35.000Z"
  }
}
```

| Status Code | Meaning |
|---|---|
| 200 | Accepted, payment link issued |
| 403 | Unauthorized (booking belongs to a different agency) |
| 404 | Booking not found |
| 400 | Not in `INQUIRY` state, or slot capacity exceeded |


### 1.6 Reject Booking

**Method / Path:** `PATCH /agencies/me/bookings/:id/reject`
**Auth required:** Yes — `AGENCY_ADMIN`

**Request Body**

```json
{ "reason": "..." }
```

Required, non-empty. Only valid from `INQUIRY`. No slots were ever reserved at this point, so nothing needs releasing.

| Status Code | Meaning |
|---|---|
| 200 | Rejected |
| 403 | Unauthorized |
| 404 | Booking not found |
| 400 | Missing reason, or not in `INQUIRY` state |


### 1.7 Propose Alternative Date

**Method / Path:** `PATCH /agencies/me/bookings/:id/propose-date`
**Auth required:** Yes — `AGENCY_ADMIN`

**Request Body**

```json
{ "proposedDate": "2026-09-14" }
```

Required, must parse as a valid date. Only valid from `INQUIRY`.

Status → `ALTERNATIVE_PROPOSED` (a terminal state for the agency; the trekker decides next, outside the agency dashboard).

| Status Code | Meaning |
|---|---|
| 200 | Date proposed |
| 403 | Unauthorized |
| 404 | Booking not found |
| 400 | Missing/invalid date, or not in `INQUIRY` state |


### 1.8 Confirm Booking

**Method / Path:** `PATCH /agencies/me/bookings/:id/confirm`
**Auth required:** Yes — `AGENCY_ADMIN`

Only valid from `PAID`. This is a separate, explicit manual step after the payment webhook already moved the booking to `PAID` — the webhook does not auto-confirm.

| Status Code | Meaning |
|---|---|
| 200 | Confirmed |
| 403 | Unauthorized |
| 404 | Booking not found |
| 400 | Not in `PAID` state |


### 1.9 Cancel Booking

**Method / Path:** `PATCH /agencies/me/bookings/:id/cancel`
**Auth required:** Yes — `AGENCY_ADMIN`

**Request Body**

```json
{ "reason": "..." }
```

Required, non-empty. Valid from `PAYMENT_PENDING`, `PAID`, `CONFIRMED`, or `ACTIVE`. Runs atomically: releases reserved slots, sets status to `CANCELLED`.

| Status Code | Meaning |
|---|---|
| 200 | Cancelled |
| 403 | Unauthorized |
| 404 | Booking not found |
| 400 | Missing reason, or booking not in a cancellable state |


### 1.10 Assign Guide

**Method / Path:** `PATCH /agencies/me/bookings/:id/assign-guide`
**Auth required:** Yes — `AGENCY_ADMIN`

**Request Body**

```json
{ "guideRef": "GUIDE_123" }
```

Only valid from `CONFIRMED`. Validates the guide exists for this agency (`agencyId_guideRef` composite unique) and `isActive = true`. Does not change booking status.

| Status Code | Meaning |
|---|---|
| 200 | Guide assigned |
| 403 | Unauthorized |
| 404 | Booking not found |
| 400 | Not in `CONFIRMED` state, or guide not found/inactive |


### 1.11 Check In (Start Trek)

**Method / Path:** `PATCH /agencies/me/bookings/:id/check-in`
**Auth required:** Yes — `AGENCY_ADMIN`

Only valid from `CONFIRMED`, and only once `assignedGuideId` is set. Status → `ACTIVE`.

| Status Code | Meaning |
|---|---|
| 200 | Checked in, trek started |
| 403 | Unauthorized |
| 404 | Booking not found |
| 400 | Not in `CONFIRMED` state, or no guide assigned yet |


### 1.12 Check Out (Complete Trek)

**Method / Path:** `PATCH /agencies/me/bookings/:id/check-out`
**Auth required:** Yes — `AGENCY_ADMIN`

Only valid from `ACTIVE`. Status → `COMPLETED`.

| Status Code | Meaning |
|---|---|
| 200 | Checked out, trek completed |
| 403 | Unauthorized |
| 404 | Booking not found |
| 400 | Not in `ACTIVE` state |


### 1.13 Payment Webhooks

**Base pattern:** `POST /webhooks/payment/:agencyId/{provider}` — the webhook is scoped per agency, not shared across a single provider path.

| Provider | Path | Signature / Verification | Amount + Booking ID Extraction |
|---|---|---|---|
| Stripe | `/webhooks/payment/:agencyId/stripe` | Stripe signature header verified against `STRIPE_WEBHOOK_SECRET` via `verifyStripeSignature` | `event.data.object.metadata.bookingId` / `agencyId`; amount from `amount_received / 100` |
| Khalti | `/webhooks/payment/:agencyId/khalti` | Server-side lookup `verifyKhaltiPayment(pidx)` calls Khalti's API and checks `status === "Completed"` (not a local signature check) | `purchase_order_id` → `bookingId`; amount from the verified lookup response |
| eSewa | `/webhooks/payment/:agencyId/esewa` | Body's base64 `data` field is decoded to JSON, then signature is computed from the signed fields and compared against `payload.signature` using `ESEWA_SECRET_KEY` | `payload.transaction_uuid` → `bookingId`; amount from `payload.total_amount` (commas stripped, parsed as float) |
| ConnectIPS | `/webhooks/payment/:agencyId/connectips` | A message string is built from merchant/app/transaction fields and verified against `TOKEN` using `CONNECTIPS_SECRET_KEY` | `REFERENCEID` → `bookingId`; amount from `TXNAMT / 100` |

All four ultimately call `processConfirmedPayment(bookingId, agencyId, amountPaid)`:

- Returns silently (no-op) if `paymentLink.used` is already `true` — protects against gateway webhook retries
- Throws if the booking is not currently `PAYMENT_PENDING` — blocks a late/duplicate webhook from overwriting a booking that has already moved on (`CONFIRMED`) or died (`CANCELLED`)
- Throws on amount mismatch (`|amountPaid - totalPrice| > 0.01`)
- On success (in one transaction): status → `PAID`, `paymentLink.used = true`
- Generates a booking-confirmation PDF (itinerary, add-ons, guide info) and emails it to the trekker
- Sends a guide-assignment email only if `assignedGuideEmail`/`assignedGuideName` are set — currently these are always `null` because guide auto-assignment is stubbed, so this email path does not fire in practice yet
- Notifies agency admins ("Payment Received — please confirm the booking") — this is a prompt for the agency to call `PATCH /:id/confirm` (§1.8), not an automatic confirmation

> Webhook routes themselves return HTTP status codes and body shape not confirmed from the excerpt provided — flagged as outstanding if you need it documented precisely.


## 2. Status Enum & Transitions

Actual `BookingStatus` enum (from `schema.prisma`):

```prisma
enum BookingStatus {
  INQUIRY
  CONFIRMED
  PAYMENT_PENDING
  REJECTED
  ALTERNATIVE_PROPOSED
  PAID
  ACTIVE
  COMPLETED
  CANCELLED
}
```

**Transition map (from service logic):**

| From | Action | To |
|---|---|---|
| `INQUIRY` | Accept | `PAYMENT_PENDING` |
| `INQUIRY` | Reject | `REJECTED` (terminal) |
| `INQUIRY` | Propose date | `ALTERNATIVE_PROPOSED` (terminal for agency) |
| `PAYMENT_PENDING` | Webhook payment confirmed | `PAID` |
| `PAYMENT_PENDING` | 48h expiry (cron) | `CANCELLED` |
| `PAYMENT_PENDING` | Agency cancel | `CANCELLED` |
| `PAID` | Agency confirm | `CONFIRMED` |
| `PAID` | Agency cancel | `CANCELLED` |
| `CONFIRMED` | Assign guide | `CONFIRMED` |
| `CONFIRMED` | Check-in (requires guide) | `ACTIVE` |
| `CONFIRMED` | Agency cancel | `CANCELLED` |
| `ACTIVE` | Check-out | `COMPLETED` (terminal) |
| `ACTIVE` | Agency cancel (emergency) | `CANCELLED` |

> **Deviation from the original plan:** the plan describes `INQUIRY → PENDING → CONFIRMED → PAYMENT_PENDING → PAID → ...`. The actual enum has no `PENDING` value, and `CONFIRMED` occurs after `PAID`, not before `PAYMENT_PENDING`. Slot capacity is also reserved at accept (before payment), not decremented at payment time as the plan implies — payment only flips status and marks the payment link used.


| Table (model) | Purpose | Key relations / constraints |
|---|---|---|
| `bookings` (`Booking`) | Core booking record — trekker details, status, pricing, guide assignment, offline-cache metadata | FK → Agency, Trekker, TrekPackage, Branch, TrekDepartureDate. 1:many `addOns`; 1:1 `paymentLink`, `review`, `reviewInvitation`. Indexes: `[agencyId, status]`, `[trekkerId]` |
| `booking_add_ons` (`BookingAddOn`) | Snapshot of add-ons selected for a booking, including price at time of booking | FK → Booking (cascade), TrekAddOn. Unique: `[bookingId, addOnId]` |
| `payment_links` (`PaymentLink`) | One payment link per booking — url token, amount, 48h expiry, used flag | Unique FK → Booking (cascade) |
| `trek_departure_dates` (`TrekDepartureDate`) | A specific departure date for a package, with slot capacity and status | FK → TrekPackage (cascade). Status flips to `FULL` when `bookedSlots >= maxSlots` |
| `trek_add_ons` (`TrekAddOn`) | Optional add-ons available for a package, priced per-person or flat | FK → TrekPackage (cascade) |
| `guide_profiles` (`GuideProfile`) | Guides available to an agency, matched to bookings via `guideRef` | FK → Agency (cascade), Branch. Unique: `[agencyId, guideRef]` |
| `coupons` (`Coupon`) | Discount codes scoped to an agency, with usage limits and eligibility rules | FK → Agency (cascade). Unique: `[agencyId, code]` |


## 4. Backend Structure

Layered structure:

```
apps/api/src/
├── controllers/
│   └── booking.controller.ts
├── services/
│   ├── booking.service.ts
│   ├── departureDate.service.ts
│   ├── coupon.service.ts
│   ├── payment.service.ts
│   ├── notification.service.ts
│   └── email.service.ts (part of utils/email.ts)
├── routes/
│   ├── booking.routes.ts
│   └── payment.webhook.routes.ts
├── lib/
│   ├── generatePDF.ts
│   └── verifySignature.ts
├── utils/
│   ├── email.ts
│   ├── khalti.ts, esewa.ts, stripe.ts, connectIPS.ts
│   └── redis.ts
├── jobs/
│   └── expireUnpaidBookings.job.ts
├── types/
│   └── (auth-request.ts, notification.types.ts)
├── middleware/
│   └── (requireAuth, requireRole, etc.)
└── validations/
    └── (Booking input validation)
```

**Main files (`apps/api/src`):**

| File | Responsibility |
|---|---|
| `booking.controller.ts` | HTTP request handlers for all booking endpoints |
| `booking.service.ts` | Core business logic — submit inquiry, verify OTP, accept, reject, propose date, confirm, cancel, assign guide, check-in/out |
| `departureDate.service.ts` | Slot confirmation/release for bookings; departure-date CRUD |
| `coupon.service.ts` | Coupon validation, discount calculation, and CRUD |
| `payment.service.ts` | Payment webhook processing (`processConfirmedPayment`), unpaid-booking expiry logic |
| `notification.service.ts` | Push notifications to trekkers and in-app alerts to agency admins |
| `email.ts` | Email templates and sending (OTP, inquiry, acceptance, rejection, confirmation, etc.) |
| `booking.routes.ts` | Route definitions for public and agency-scoped booking endpoints |
| `payment.webhook.routes.ts` | Per-gateway payment webhook routes (Stripe, Khalti, eSewa, ConnectIPS) |
| `generatePDF.ts` | Booking confirmation PDF generation (pdfkit) |
| `verifySignature.ts` | Signature/verification logic for each payment gateway's webhook |
| `khalti.ts` / `esewa.ts` / `stripe.ts` / `connectIPS.ts` | Payment gateway API integration helpers |
| `redis.ts` | Redis operations for OTP and inquiry session storage |
| `expireUnpaidBookings.job.ts` | Cron job that cancels unpaid bookings past the 48-hour payment window |


## 5. Business Logic

- Slot capacity is reserved at **accept**, not at payment — `confirmSlotsForBooking` re-checks `maxSlots - bookedSlots` inside the same transaction that flips status to `PAYMENT_PENDING`, so two agencies (or two accept calls) racing for the last seats can't both succeed.
- A departure date flips to `FULL` the moment `bookedSlots >= maxSlots` — computed inline in the same update, not a separate step.
- Releasing slots (on cancel or on payment-window expiry) recalculates status via `deriveStatus(bookedSlots, maxSlots, currentStatus)`, which explicitly preserves a `GUARANTEED` status rather than reverting it, since that represents an explicit agency commitment independent of slot count.
- Add-on uniqueness per booking is enforced at the database level via the `[bookingId, addOnId]` unique constraint on `BookingAddOn`, not just application logic.
- Payment webhook idempotency is enforced two ways:
  1. `paymentLink.used` short-circuits a repeat webhook silently
  2. A booking not in `PAYMENT_PENDING` throws, blocking a late webhook from clobbering a booking that already moved to `CONFIRMED`/`CANCELLED`
- Payment amount is reconciled against `booking.totalPrice` with a small tolerance (`> 0.01` difference triggers a mismatch error) to absorb floating-point rounding, not exact equality.


## 6. Environment & Configuration

| Variable | Purpose |
|---|---|
| `APP_URL` | Base URL used to build the payment link sent to trekkers |
| `STRIPE_WEBHOOK_SECRET` | Verifies the `stripe-signature` header on Stripe webhooks |
| `KHALTI_SECRET_KEY` | Used server-side to call Khalti's payment lookup/verification API |
| `KHALTI_PUBLIC_KEY` | Khalti client-side integration key |
| `ESEWA_SECRET_KEY` | Verifies the signature on decoded eSewa webhook payloads |
| `ESEWA_MERCHANT_CODE` / `ESEWA_MERCHANT_SECRET` | eSewa merchant integration credentials |
| `CONNECTIPS_SECRET_KEY` | Verifies the `TOKEN` field on ConnectIPS webhook payloads |
| `CONNECTIPS_MERCHANT_ID` / `CONNECTIPS_APP_ID` / `CONNECTIPS_APP_NAME` | Fields included in the ConnectIPS signature-verification message |
| `CONNECTIPS_CLIENT_ID` / `CONNECTIPS_CLIENT_SECRET` | ConnectIPS client integration credentials |

> **Not env-configurable:** the 48-hour payment-link expiry is hardcoded in `booking.service.ts` (`Date.now() + 48 * 60 * 60 * 1000`) rather than read from an environment variable.

**Cron registration (`app.ts`, startup):**

```ts
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  startSubscriptionCron();
  startVisibilityScoreCron();
  startExpireUnpaidBookingsCron();
}
```

## 7. Error Handling

Booking routes use a `{ success, data }` / `{ success: false, message }` envelope — not the plain `{ message }` shape used by the auth routes. Every controller wraps its service call in try/catch and derives the HTTP status from substrings in the thrown `Error.message` (e.g. containing `"Unauthorized"` → 403, `"not found"` → 404), rather than using typed/custom error classes.

**Success example**

```json
{ "success": true, "data": { "bookingId": "...", "status": "PAYMENT_PENDING" } }
```

**Failure example**

```json
{ "success": false, "message": "Booking is not in INQUIRY state" }
```

| HTTP Code | Typical Trigger |
|---|---|
| 200 | Action succeeded |
| 201 | Booking created (verify-otp) |
| 202 | OTP issued (submit-inquiry) |
| 400 | Validation failure, wrong booking state, missing required field |
| 403 | Booking belongs to a different agency |
| 404 | Booking not found |
| 409 | Package/departure date unavailable (submit-inquiry only) |
| 500 | Unexpected/unclassified failure |
