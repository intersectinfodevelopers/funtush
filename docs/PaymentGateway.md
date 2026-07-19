# Payment Integration

## Overview

Implemented a secure and scalable payment integration system that enables agencies to securely manage payment gateway credentials and subscribe to paid plans through Stripe. The solution combines encrypted credential storage, subscription lifecycle management, webhook processing, and automated grace period handling to ensure secure payment operations and reliable billing.

> **Note:** Stripe integration serves as a template for international expansion and is not currently available in Nepal.


## Features

### Secure Credential Storage

Implemented encrypted storage for payment gateway credentials using **AES-256-GCM** encryption to ensure sensitive information is protected at rest.

#### Security Implementation

- AES-256-GCM encryption algorithm
- Random 16-byte Initialization Vector (IV) generated for each encryption
- Encrypted format: `iv:authTag:encrypted` (hex encoded)
- Encryption key loaded from environment variables
- Credentials stored as write-only and never exposed through API responses

###  Subscription Management

Integrated Stripe subscription billing to manage agency subscription plans and automate the billing lifecycle.

#### Subscription Flow

1. Agency subscribes to a selected subscription tier.
2. Stripe customer is created using the agency email.
3. Stripe subscription is generated with tier-based pricing.
4. Client Secret is returned for frontend payment confirmation.

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

###  Grace Period Management

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

### Subscription Billing

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


## Authentication & Security

### Agency APIs

Require:

- `X-Refresh-Token` header
- Active agency account

### Webhook Endpoint

- Stripe webhook signature verification
- Protection against unauthorized webhook requests


## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | AES-256-GCM encryption key for credential storage |
| `STRIPE_SECRET_KEY` | Stripe Secret API Key |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook Signing Secret |


## Key Highlights

- AES-256-GCM encrypted payment credential storage
- Write-only credential management
- Stripe subscription lifecycle management
- Secure webhook signature verification
- Automatic 7-day grace period for failed payments
- Subscription status synchronization with Stripe
- Comprehensive webhook event logging for auditing and troubleshooting