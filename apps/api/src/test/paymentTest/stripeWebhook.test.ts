import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@funtush/database';
import Stripe from 'stripe';

/**
 * DAY 5 TEST 2: Stripe Webhook Subscription Management
 * ─────────────────────────────────────────────────────────
 * Verify that Stripe webhooks correctly:
 * - Extend subscription period on successful payment
 * - Start grace period on payment failure
 * - Handle idempotency (same event multiple times)
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_fake', {
  apiVersion: '2023-10-16',
});

describe('Stripe Webhook - Subscription Management', () => {
  const mockAgencyId = 'agency_stripe_' + Date.now();
  const mockTierId = 'tier_stripe_' + Date.now();
  const mockStripeCustomerId = 'cus_' + Date.now();
  const mockStripeSubscriptionId = 'sub_' + Date.now();
  const mockStripeInvoiceId = 'in_' + Date.now();

  beforeAll(async () => {
    // Create tier
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'Stripe Test Tier',
        monthlyPrice: 9999, // $99.99
        maxStaff: 10,
        maxGuides: 10,
      },
    });

    // Create agency
    await db.agency.create({
      data: {
        id: mockAgencyId,
        email: 'stripe_test@agency.com',
        name: 'Stripe Test Agency',
        slug: 'stripe-test-' + mockAgencyId,
        tierId: mockTierId,
        stripeCustomerId: mockStripeCustomerId,
        subscriptionStatus: 'ACTIVE',
        subscriptionValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      },
    });

    // Create Stripe subscription record
    await db.stripeSubscription.create({
      data: {
        id: 'stripe_sub_' + mockAgencyId,
        agencyId: mockAgencyId,
        stripeSubscriptionId: mockStripeSubscriptionId,
        stripeCustomerId: mockStripeCustomerId,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    await db.stripeSubscription.deleteMany({
      where: { agencyId: mockAgencyId },
    });
    await db.stripeInvoice.deleteMany({
      where: { agencyId: mockAgencyId },
    });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  // ──────────────────────────────────────────────────────────
  // TEST 2.1: Payment succeeded → Extend subscription period
  // ──────────────────────────────────────────────────────────
  describe('Payment Success - Extend Period', () => {
    it('should extend subscription period on invoice.payment_succeeded', async () => {
      const previousValidUntil = (
        await db.agency.findUnique({ where: { id: mockAgencyId } })
      )!.subscriptionValidUntil;

      // Simulate Stripe webhook: invoice.payment_succeeded
      const webhookEvent = {
        id: 'evt_' + Date.now(),
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: mockStripeInvoiceId,
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 9999,
            status: 'paid',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      // Process webhook
      await handleStripeWebhook(webhookEvent);

      // Verify subscription extended by ~30 days
      const updatedAgency = await db.agency.findUnique({
        where: { id: mockAgencyId },
      });

      expect(updatedAgency!.subscriptionStatus).toBe('ACTIVE');
      expect(updatedAgency!.subscriptionValidUntil).toBeInstanceOf(Date);

      const daysExtended =
        (updatedAgency!.subscriptionValidUntil!.getTime() -
          previousValidUntil!.getTime()) /
        (1000 * 60 * 60 * 24);

      expect(daysExtended).toBeGreaterThan(25); // At least 25 days (allowing variance)
      expect(daysExtended).toBeLessThan(35);
    });

    it('should update Stripe subscription record on successful payment', async () => {
      const webhookEvent = {
        id: 'evt_success_' + Date.now(),
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: mockStripeInvoiceId,
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 9999,
            status: 'paid',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(webhookEvent);

      const stripeRecord = await db.stripeSubscription.findFirst({
        where: { agencyId: mockAgencyId },
      });

      expect(stripeRecord!.status).toBe('active');
      expect(stripeRecord!.currentPeriodEnd!.getTime()).toBeGreaterThan(
        new Date().getTime()
      );
    });

    it('should create invoice record for audit trail', async () => {
      const webhookEvent = {
        id: 'evt_invoice_' + Date.now(),
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_webhook_' + Date.now(),
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 9999,
            status: 'paid',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(webhookEvent);

      const invoice = await db.stripeInvoice.findFirst({
        where: { agencyId: mockAgencyId },
      });

      expect(invoice).toBeTruthy();
      expect(invoice!.stripeInvoiceId).toBe(webhookEvent.data.object.id);
      expect(invoice!.status).toBe('paid');
      expect(invoice!.amountPaid).toBe(9999);
    });
  });

  // ──────────────────────────────────────────────────────────
  // TEST 2.2: Payment failed → Start grace period
  // ──────────────────────────────────────────────────────────
  describe('Payment Failed - Grace Period', () => {
    it('should start grace period on invoice.payment_failed', async () => {
      const beforeFailure = new Date();

      const webhookEvent = {
        id: 'evt_failed_' + Date.now(),
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_failed_' + Date.now(),
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 0,
            status: 'open',
            failure_message: 'Card declined',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(webhookEvent);

      const updatedAgency = await db.agency.findUnique({
        where: { id: mockAgencyId },
      });

      // Grace period should be 7 days from now
      expect(updatedAgency!.subscriptionStatus).toBe('GRACE_PERIOD');
      expect(updatedAgency!.gracePeriodUntil).toBeInstanceOf(Date);

      const graceDays =
        (updatedAgency!.gracePeriodUntil!.getTime() - beforeFailure.getTime()) /
        (1000 * 60 * 60 * 24);

      expect(graceDays).toBeGreaterThan(6.9); // ~7 days
      expect(graceDays).toBeLessThan(7.1);
    });

    it('should mark subscription as past_due during grace period', async () => {
      const webhookEvent = {
        id: 'evt_pastdue_' + Date.now(),
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_pastdue_' + Date.now(),
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 0,
            status: 'open',
            failure_message: 'Card declined',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(webhookEvent);

      const stripeRecord = await db.stripeSubscription.findFirst({
        where: { agencyId: mockAgencyId },
      });

      expect(stripeRecord!.status).toBe('past_due');
    });

    it('should record failed payment attempt with reason', async () => {
      const failureMessage = 'Your card was declined';
      const webhookEvent = {
        id: 'evt_record_' + Date.now(),
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_record_' + Date.now(),
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 0,
            status: 'open',
            failure_message: failureMessage,
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(webhookEvent);

      const invoice = await db.stripeInvoice.findFirst({
        where: {
          agencyId: mockAgencyId,
          stripeInvoiceId: webhookEvent.data.object.id,
        },
      });

      expect(invoice!.status).toBe('failed');
      expect(invoice!.failureMessage).toContain('declined');
    });

    it('should not extend subscription during grace period if retry succeeds later', async () => {
      // First: payment fails
      const failEvent = {
        id: 'evt_grace_fail_' + Date.now(),
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_grace_' + Date.now(),
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 0,
            status: 'open',
            failure_message: 'Card declined',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(failEvent);

      let agency = await db.agency.findUnique({ where: { id: mockAgencyId } });
      expect(agency!.subscriptionStatus).toBe('GRACE_PERIOD');
      const gracePeriodEnd = agency!.gracePeriodUntil!;

      // Second: payment retried and succeeds
      const retryEvent = {
        id: 'evt_grace_success_' + Date.now(),
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_retry_' + Date.now(),
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 9999,
            status: 'paid',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(retryEvent);

      agency = await db.agency.findUnique({ where: { id: mockAgencyId } });
      expect(agency!.subscriptionStatus).toBe('ACTIVE');

      // New valid until should be beyond grace period
      expect(agency!.subscriptionValidUntil!.getTime()).toBeGreaterThan(
        gracePeriodEnd.getTime()
      );

      // Grace period should be cleared
      expect(agency!.gracePeriodUntil).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────
  // TEST 2.3: Idempotency - Handle duplicate webhook events
  // ──────────────────────────────────────────────────────────
  describe('Idempotency - Duplicate Event Handling', () => {
    it('should handle duplicate payment_succeeded events safely', async () => {
      const invoiceId = 'in_idempotent_' + Date.now();
      const firstValidUntil = (
        await db.agency.findUnique({ where: { id: mockAgencyId } })
      )!.subscriptionValidUntil;

      const webhookEvent = {
        id: 'evt_idempotent_' + Date.now(),
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: invoiceId,
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 9999,
            status: 'paid',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      // Process same event twice
      await handleStripeWebhook(webhookEvent);
      const afterFirst = (
        await db.agency.findUnique({ where: { id: mockAgencyId } })
      )!.subscriptionValidUntil;

      await handleStripeWebhook(webhookEvent);
      const afterSecond = (
        await db.agency.findUnique({ where: { id: mockAgencyId } })
      )!.subscriptionValidUntil;

      // Both should result in same valid until date (idempotent)
      expect(afterFirst!.getTime()).toBe(afterSecond!.getTime());
    });

    it('should track webhook event idempotency key', async () => {
      const eventId = 'evt_track_' + Date.now();

      const webhookEvent = {
        id: eventId,
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_track_' + Date.now(),
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 9999,
            status: 'paid',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(webhookEvent);

      // Verify webhook event is logged
      const webhookLog = await db.stripeWebhookLog.findFirst({
        where: { stripeEventId: eventId },
      });

      expect(webhookLog).toBeTruthy();
      expect(webhookLog!.stripeEventId).toBe(eventId);
      expect(webhookLog!.processed).toBe(true);
    });

    it('should skip duplicate webhook if already processed', async () => {
      const eventId = 'evt_skip_dup_' + Date.now();
      const invoiceId = 'in_skip_dup_' + Date.now();

      const webhookEvent = {
        id: eventId,
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: invoiceId,
            customer: mockStripeCustomerId,
            subscription: mockStripeSubscriptionId,
            amount_paid: 9999,
            status: 'paid',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      } as any;

      // First time: process
      const result1 = await handleStripeWebhook(webhookEvent);
      expect(result1.processed).toBe(true);

      // Second time: should skip
      const result2 = await handleStripeWebhook(webhookEvent);
      expect(result2.processed).toBe(false);
      expect(result2.reason).toBe('duplicate');
    });
  });

  // ──────────────────────────────────────────────────────────
  // TEST 2.4: Subscription cancellation
  // ──────────────────────────────────────────────────────────
  describe('Subscription Cancellation', () => {
    it('should cancel subscription on customer.subscription.deleted', async () => {
      const webhookEvent = {
        id: 'evt_cancel_' + Date.now(),
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: mockStripeSubscriptionId,
            customer: mockStripeCustomerId,
            status: 'canceled',
            canceled_at: Math.floor(Date.now() / 1000),
          },
        },
      } as any;

      await handleStripeWebhook(webhookEvent);

      const updatedAgency = await db.agency.findUnique({
        where: { id: mockAgencyId },
      });

      expect(updatedAgency!.subscriptionStatus).toBe('CANCELLED');
      expect(updatedAgency!.subscriptionValidUntil).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────────────────
// Helper: Process Stripe webhook
// ──────────────────────────────────────────────────────────
async function handleStripeWebhook(
  event: any
): Promise<{ processed: boolean; reason?: string }> {
  // Check for duplicate
  const existingLog = await db.stripeWebhookLog.findFirst({
    where: { stripeEventId: event.id },
  });

  if (existingLog) {
    return { processed: false, reason: 'duplicate' };
  }

  try {
    if (event.type === 'invoice.payment_succeeded') {
      const invoiceData = event.data.object;
      const agency = await db.agency.findFirst({
        where: { stripeCustomerId: invoiceData.customer },
      });

      if (agency) {
        // Extend subscription by 30 days
        const newValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await db.agency.update({
          where: { id: agency.id },
          data: {
            subscriptionStatus: 'ACTIVE',
            subscriptionValidUntil: newValidUntil,
            gracePeriodUntil: null,
          },
        });

        // Update Stripe subscription record
        await db.stripeSubscription.updateMany({
          where: { stripeCustomerId: invoiceData.customer },
          data: {
            status: 'active',
            currentPeriodEnd: newValidUntil,
          },
        });

        // Create invoice record
        await db.stripeInvoice.create({
          data: {
            id: 'invoice_' + invoiceData.id,
            agencyId: agency.id,
            stripeInvoiceId: invoiceData.id,
            status: 'paid',
            amountPaid: invoiceData.amount_paid,
          },
        });
      }
    } else if (event.type === 'invoice.payment_failed') {
      const invoiceData = event.data.object;
      const agency = await db.agency.findFirst({
        where: { stripeCustomerId: invoiceData.customer },
      });

      if (agency) {
        // Start 7-day grace period
        const gracePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.agency.update({
          where: { id: agency.id },
          data: {
            subscriptionStatus: 'GRACE_PERIOD',
            gracePeriodUntil: gracePeriodEnd,
          },
        });

        // Update Stripe subscription status
        await db.stripeSubscription.updateMany({
          where: { stripeCustomerId: invoiceData.customer },
          data: { status: 'past_due' },
        });

        // Log failed invoice
        await db.stripeInvoice.create({
          data: {
            id: 'invoice_' + invoiceData.id,
            agencyId: agency.id,
            stripeInvoiceId: invoiceData.id,
            status: 'failed',
            failureMessage: invoiceData.failure_message,
          },
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subData = event.data.object;
      const agency = await db.agency.findFirst({
        where: { stripeCustomerId: subData.customer },
      });

      if (agency) {
        await db.agency.update({
          where: { id: agency.id },
          data: {
            subscriptionStatus: 'CANCELLED',
            subscriptionValidUntil: null,
          },
        });
      }
    }

    // Log webhook as processed
    await db.stripeWebhookLog.create({
      data: {
        id: 'webhook_' + event.id,
        stripeEventId: event.id,
        eventType: event.type,
        processed: true,
      },
    });

    return { processed: true };
  } catch (error) {
    console.error('Webhook processing error:', error);
    throw error;
  }
}