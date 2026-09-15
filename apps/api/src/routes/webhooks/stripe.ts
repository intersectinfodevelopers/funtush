import { Router, raw } from 'express';
import Stripe from 'stripe';
import { getStripeWebhookSecret } from '../../utils/stripe';
import {
  handleInvoicePaid,
  handlePaymentFailed,
  handleSubscriptionDeleted,
} from '../../services/stripeSubscriptionService';
import { db } from '@funtush/database';

const router = Router();

/**
 * @openapi
 * /webhooks/stripe:
 *   post:
 *     tags: [Webhooks]
 *     summary: Stripe subscription webhook (invoice.paid, invoice.payment_failed, customer.subscription.deleted)
 *     description: Verified via the `Stripe-Signature` header against the raw request body (mounted before the global JSON parser). Every event is logged to `stripeWebhookLog` for idempotency/audit before being processed.
 *     responses: { 200: { description: Received and processed }, 400: { description: Invalid/missing signature }, 500: { description: Processing failed (already logged, event still acknowledged as received by Stripe's signature check) } }
 */
router.post(
  '/stripe',
  raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    const secret = getStripeWebhookSecret();

    let event: Stripe.Event;

    try {
      event = Stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return res.status(400).send('Webhook Error');
    }

    await db.stripeWebhookLog.create({
      data: {
        eventId: event.id,
        eventType: event.type,
        resourceId: ((event.data.object as unknown) as Record<string, string>).id,
      },
    });

    try {
      switch (event.type) {
        case 'invoice.paid': {
          const invoiceRecord = (event.data.object as unknown) as Record<string, unknown>;
          const subscriptionId = invoiceRecord.subscription as string;
          if (subscriptionId) {
            await handleInvoicePaid(invoiceRecord.id as string, subscriptionId);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoiceRecord = (event.data.object as unknown) as Record<string, unknown>;
          const subscriptionId = invoiceRecord.subscription as string;
          if (subscriptionId) {
            await handlePaymentFailed(invoiceRecord.id as string, subscriptionId);
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionDeleted(subscription.id);
          break;
        }

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      await db.stripeWebhookLog.update({
        where: { eventId: event.id },
        data: { status: 'processed', processedAt: new Date() },
      });

      res.json({ received: true });
    } catch (err) {
      console.error('Webhook processing error:', err);

      await db.stripeWebhookLog.update({
        where: { eventId: event.id },
        data: {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        },
      });

      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

export default router;