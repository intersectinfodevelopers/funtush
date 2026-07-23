# Payment Integration

## Overview

Implemented a secure and scalable payment integration system that enables agencies to securely manage payment gateway credentials and subscribe to paid plans through **Stripe** and **Nepali payment gateways (Khalti, eSewa, ConnectIPS, and Fonepay)**. The solution combines encrypted credential storage, subscription lifecycle management, webhook processing, local payment gateway integration, QR-based payment collection, unified payment verification, and automated grace period handling to ensure secure payment operations and reliable billing.

> **Note:** Stripe integration serves as a template for international expansion and is not currently available in Nepal. Nepali payment gateways (Khalti, eSewa, ConnectIPS, and Fonepay) are the primary payment methods for agencies in Nepal.

## Features

### Secure Credential Storage

Implemented encrypted storage for payment gateway credentials using **AES-256-GCM** encryption to ensure sensitive information is protected at rest.

#### Security Implementation

- AES-256-GCM encryption algorithm
- Random 16-byte Initialization Vector (IV) generated for each encryption
- Encrypted format: `iv:authTag:encrypted` (hex encoded)
- Encryption key loaded from environment variables
- Credentials stored as write-only and never exposed through API responses

### Subscription Management

Integrated Stripe subscription billing to manage agency subscription plans and automate the billing lifecycle.

#### Subscription Flow

1. Agency subscribes to a selected subscription tier.
2. Stripe customer is created using the agency email.
3. Stripe subscription is generated with tier-based pricing.
4. Client Secret is returned for frontend payment confirmation.

### Nepali Payment Gateway Integration

Integrated **Khalti**, **eSewa**, and **ConnectIPS** to support subscription payments through local payment providers.

#### Supported Providers

- Khalti
- eSewa
- ConnectIPS

#### Payment Flow

1. Agency selects a subscription tier.
2. Agency chooses a preferred payment provider.
3. Payment request is initiated with the selected provider.
4. Provider-specific payment verification is performed.
5. Subscription is activated automatically after successful verification.

### Fonepay QR Payments

Integrated **Fonepay** as a QR-based local payment method, complementing the subscription-focused Khalti, eSewa, and ConnectIPS gateways by enabling agencies to collect trekker booking payments directly.

#### KYC-Gated Activation

Agencies can only activate Fonepay once their KYC submission has been approved, ensuring payment collection is only enabled for verified agencies.

##### Activation Flow

1. Agency requests Fonepay activation.
2. System checks the agency's KYC submission status.
3. If approved, a static QR code is generated via the Fonepay API.
4. The QR record is created (or updated if one already exists) and marked active.
5. The agency's tier-based transaction fee percentage is returned alongside the QR code.

#### Static & Dynamic QR Codes

Supports two QR modes to cover different payment scenarios.

- **Static QR** — generated once at activation, reusable for any payment amount.
- **Dynamic QR** — generated per booking with a fixed amount, only available once Fonepay has been activated for the agency.

#### Tier-Based Transaction Fees

Each subscription tier has an associated transaction fee percentage, stored independently and looked up whenever a Fonepay payment is processed.

##### Fee Calculation

- `feeAmount = amount * (feePercentage / 100)`
- `netAmount = amount - feeAmount`

Fees are calculated and stored on every transaction record so agencies have an auditable breakdown of gross amount, fee, and net payout.

#### Trekker-Facing Payment Verification

Implemented a public (unauthenticated) verification endpoint so trekkers can confirm payment after scanning a Fonepay QR code.

##### Verification Process

1. Trekker submits the transaction ID and amount after paying.
2. System confirms Fonepay is active for the target agency.
3. Tier fee is looked up and the fee/net split is calculated.
4. Transaction is verified directly against the Fonepay API (status + amount match).
5. On success, a transaction record is created with status `success` and a `verifiedAt` timestamp.
6. On failure, the request is rejected and no transaction record is created.

#### Status Lookup

Agencies can check their current Fonepay configuration at any time, including activation state, QR type, QR image URL, and applicable fee percentage.

### Unified Payment Verification

Implemented a single verification endpoint that supports all Nepali subscription payment providers.

#### Verification Process

- Detects the payment provider automatically.
- Verifies payment with the respective provider.
- Records payment verification for auditing.
- Updates agency subscription after successful payment.

### Webhook Processing

Implemented secure Stripe webhook handling with signature verification to synchronize payment events between Stripe and the application.

#### Supported Events

##### `invoice.paid`

- Updates subscription status to **Active**
- Extends the subscription period to the next billing cycle
- Clears any existing grace period
- Records successful payment logs

##### `invoice.payment_failed`

- Changes subscription status to **Grace Period**
- Sets a 7-day grace period
- Records failed payment logs
- Placeholder for agency notification

##### `customer.subscription.deleted`

- Marks subscription as **Cancelled**
- Records cancellation events

### Grace Period Management

Implemented automatic grace period handling to improve user experience during failed subscription payments.

When a payment fails:

- Subscription enters a **7-day grace period**
- Agency retains access to premium features
- Agency may retry payment or downgrade the subscription
- If payment is not completed within the grace period, the subscription is automatically cancelled

## Database Models

| Model | Purpose |
|--------|---------|
| `AgencyPaymentMethod` | Stores encrypted payment gateway credentials |
| `StripeSubscription` | Stores Stripe subscription details and billing status |
| `StripeWebhookLog` | Records processed Stripe webhook events for auditing and debugging |
| `KhaltiTransaction` | Stores Khalti payment details and verification status |
| `EsewaTransaction` | Stores eSewa payment details and reference IDs |
| `ConnectIPSTransaction` | Stores ConnectIPS transfer details and payment status |
| `NepaliPaymentVerification` | Stores payment verification logs for auditing |
| `FonepayQRCode` | Stores the agency's Fonepay QR code URL, type (static/dynamic), and active status |
| `FonepayTransaction` | Stores individual trekker payments — amount, fee, net amount, status, and verification timestamp |
| `TransactionFee` | Stores the fee percentage configured per subscription tier |

## API Endpoints

### Payment Methods

#### `POST /agencies/me/payment-methods`

Stores payment gateway credentials for an agency.

**Request Body**

- Provider
- API Key
- Secret
- Provider-specific configuration

**Response**

- Credential ID
- Provider
- Active status
- Created timestamp
- Updated timestamp

> Sensitive credentials are never returned.

#### `GET /agencies/me/payment-methods`

Retrieves all configured payment methods for the authenticated agency.

**Response**

- Payment Method ID
- Provider
- Active status
- Created timestamp
- Updated timestamp

> Sensitive credentials are excluded from the response.

#### `PATCH /agencies/me/payment-methods/:id/toggle`

Enables or disables a payment method.

**Response**

- Updated payment method metadata

### Stripe Subscription Billing

#### `POST /billing/subscribe`

Creates a Stripe subscription for the selected subscription tier.

**Request Body**

- Subscription Tier ID

**Response**

- Stripe Subscription ID
- Payment Client Secret

#### `POST /webhooks/stripe`

Processes Stripe webhook events after verifying the webhook signature.

Supported events:

- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.deleted`

### Nepali Payment Gateways

#### `POST /billing/subscribe/khalti/initiate`

Initiates a Khalti subscription payment.

**Response**

- Transaction ID
- Khalti payment payload

#### `POST /billing/subscribe/esewa/initiate`

Initiates an eSewa subscription payment.

**Response**

- Transaction ID
- eSewa payment payload

#### `POST /billing/subscribe/connectips/initiate`

Initiates a ConnectIPS subscription payment.

**Response**

- Transaction ID
- Transfer details

#### `POST /billing/subscribe/verify`

Verifies payments from Khalti, eSewa, and ConnectIPS through a unified endpoint.

**Request Body**

- Payment Provider
- Transaction Reference
- Provider-specific verification data

**Response**

- Payment verification status
- Transaction details
- Updated subscription information

### Fonepay QR Payments

#### `POST /agencies/me/payment-methods/fonepay/activate`

Activates Fonepay for the authenticated agency (requires KYC `APPROVED` status).

**Response**

- QR code record (URL, type, active status)
- Tier fee percentage
- Confirmation message

#### `POST /agencies/me/payment-methods/fonepay/qr/dynamic`

Generates a dynamic QR code for a specific booking amount.

**Request Body**

- Amount

**Response**

- Dynamic QR URL
- Amount

#### `GET /agencies/me/payment-methods/fonepay/status`

Retrieves the agency's current Fonepay configuration.

**Response**

- Activation status
- QR URL
- QR type
- Fee percentage

#### `POST /agencies/me/payment-methods/fonepay/verify`

Verifies a trekker's Fonepay payment (no authentication — trekker-facing).

**Request Body**

- Agency ID
- Trekker email
- Booking ID (optional)
- Transaction ID
- Amount

**Response**

- Success status
- Confirmation message
- Transaction details (amount, fee, net amount, status)

## Authentication & Security

### Agency APIs

Require:

- `X-Refresh-Token` header
- Active agency account

### Webhook Endpoint

- Stripe webhook signature verification
- Protection against unauthorized webhook requests

### Payment Verification

- Provider-specific verification
- Unified verification endpoint
- Transaction audit logging

### Fonepay Trekker Verification Endpoint

- No authentication required (public-facing for trekkers completing payment)
- Payment is independently verified against the Fonepay API before any transaction record is created, preventing forged verification requests
- Fonepay merchant code and API key are loaded from environment variables and never exposed to the client

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | AES-256-GCM encryption key for credential storage |
| `STRIPE_SECRET_KEY` | Stripe Secret API Key |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook Signing Secret |
| `KHALTI_PUBLIC_KEY` | Khalti Public API Key |
| `KHALTI_SECRET_KEY` | Khalti Secret API Key |
| `ESEWA_MERCHANT_CODE` | eSewa Merchant Code |
| `ESEWA_MERCHANT_SECRET` | eSewa Merchant Secret |
| `CONNECTIPS_CLIENT_ID` | ConnectIPS Client ID |
| `CONNECTIPS_CLIENT_SECRET` | ConnectIPS Client Secret |
| `FONEPAY_MERCHANT_CODE` | Fonepay Merchant Code |
| `FONEPAY_API_KEY` | Fonepay API Key |

international (Stripe) and local (Khalti, eSewa, ConnectIPS, Fonepay) payment providers