# Marketplace Visibility

## Overview

The Marketplace Visibility module is responsible for ranking trekking agencies in marketplace search results. It uses a precomputed visibility score based on agency tier, quality metrics, and administrator overrides to ensure fast and consistent search performance. Additionally, the module tracks marketplace impressions, clicks, and conversions to provide agencies with insights into their marketplace performance.

---

## Features

- Tier-based visibility scoring
- Quality bonus calculation
- Admin visibility override
- Sponsored agency support
- Trekker loyalty boost
- Marketplace impression tracking
- Marketplace click tracking
- Marketplace conversion tracking
- Agency marketplace analytics
- Top-performing agencies analytics

---

## Visibility Score

Each agency has a precomputed visibility score stored in the `AgencyVisibilityScore` table.

### Score Formula

```text
Final Score =
Base Score +
Quality Bonus +
Admin Override
(+ Loyalty Bonus at search time)
```

The final score is used as the primary ranking factor during marketplace searches.

---

## Base Score

The base score depends on the agency's subscription tier.

| Tier | Base Score |
|------|-----------:|
| Large | 100 |
| Medium | 50 |
| Small | 25 |
| Free | 0 |

---

## Quality Bonus

Additional points are awarded based on agency quality.

| Condition | Bonus |
|-----------|------:|
| Average rating ≥ 4.5 | +20 |
| Booking within last 7 days | +5 |
| Profile completed | +10 |

The quality bonus is the sum of all applicable conditions.

---

## Admin Override

Administrators can manually increase an agency's visibility score.

```text
Final Score =
Base Score +
Quality Bonus +
Admin Override
```

### Characteristics

- Applied on top of the calculated score
- Does not modify agency tier
- Does not unlock additional features
- Affects only marketplace ranking
- Agencies with an override are marked as sponsored

---

## Trekker Loyalty Boost

When a trekker searches the marketplace, agencies previously booked by that trekker receive an additional boost.

```text
Loyalty Bonus = +50
```

Characteristics:

- Applied only for the requesting trekker
- Calculated during search
- Not stored in the database

---

## Marketplace Ranking

Marketplace search results are sorted using the following order:

1. Final Score (Descending)
2. Average Rating (Descending)
3. Recent Activity

---

## Sponsored Agencies

If an agency has an administrator override greater than zero, the marketplace API returns:

```json
{
  "sponsored": true
}
```

The frontend displays these agencies with a **Sponsored** badge to indicate promoted listings.

---

# Marketplace Analytics

The analytics module records user interactions with marketplace listings.

## Impression Tracking

An impression is recorded whenever an agency appears in marketplace search results.

Features:

- One impression per agency per day
- Daily impression aggregation
- Stored in the `MarketplaceImpression` table

---

## Click Tracking

A click is recorded whenever a user opens an agency from marketplace results.

Each click stores:

- Agency ID
- Trekker ID (if authenticated)
- Destination
- Search query
- Timestamp

---

## Conversion Tracking

Conversions measure how marketplace clicks lead to inquiries or bookings.

A conversion is counted when a booking occurs within the configured conversion window after a marketplace click.

Metrics include:

- Total clicks
- Total conversions
- Conversion rate

---

# API Endpoints

## Marketplace Impressions

```http
GET /agencies/me/marketplace/impressions?period=last_30_days
```

Returns:

- Total impressions
- Total clicks
- Click-through rate (CTR)
- Total conversions
- Conversion rate
- Daily statistics

---

## Marketplace Conversions

```http
GET /agencies/me/marketplace/conversions
```

Returns:

- Marketplace clicks
- Converted clicks
- Conversion rate
- Conversion details

---

## Update Agency Visibility

```http
PATCH /admin/agencies/:id/visibility
```

Updates:

- Admin override
- Final visibility score
- Sponsored status

---

## Data Models

### AgencyVisibilityScore

| Field | Description |
|--------|-------------|
| agencyId | Agency identifier |
| baseScore | Tier-based score |
| qualityBonus | Bonus based on quality metrics |
| adminOverride | Administrator-defined boost |
| finalScore | Total visibility score |

---

### MarketplaceImpression

Stores daily marketplace analytics.

| Field |
|--------|
| agencyId |
| date |
| impressionCount |
| clickCount |
| conversionCount |

---

### MarketplaceClick

Stores click events generated from marketplace listings.

| Field |
|--------|
| agencyId |
| trekkerId |
| destination |
| searchQuery |
| timestamp |

---

## Visibility Score Recalculation

Visibility scores are recalculated periodically to keep marketplace rankings up to date.

Each recalculation updates:

- Base score
- Quality bonus
- Final score

Administrator overrides remain unchanged and are added to the recalculated score.

---

---

# Testing

The Marketplace Visibility module includes unit tests to verify the correctness of visibility scoring and marketplace analytics functionality.

## Covered Scenarios

### Marketplace Analytics

- Recording marketplace impressions
- Recording agency card clicks
- Recording conversions
- Calculating click-through rate (CTR)
- Calculating conversion rate
- Handling agencies with zero impressions
- Validating supported reporting periods

### Conversion Tracking

- Linking marketplace clicks to bookings within the conversion window
- Ignoring bookings outside the conversion window
- Handling anonymous marketplace clicks

### Agency Rankings

- Retrieving top agencies by marketplace impressions
- Calculating CTR for ranked agencies
- Handling agencies with no recorded clicks

## Test Framework

- **Vitest** for unit testing
- **Prisma mocks** for database interactions
- Mocked service dependencies to ensure isolated and deterministic tests

## Running Tests

```bash
pnpm test
```

To run lint checks:

```bash
pnpm lint
```

The test suite validates the correctness of marketplace analytics calculations, ranking logic, and API service behavior without requiring a live database.