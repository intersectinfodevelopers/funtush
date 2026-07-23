import { db } from '@funtush/database';
import { getStripeClient } from '../utils/stripe';

export async function createStripeSubscription(
  agencyId: string,
  email: string,
  subscriptionTierId: string
) {
  const stripe = getStripeClient();

  const tier = await db.subscriptionTier.findUnique({
    where: { id: subscriptionTierId },
  });

  if (!tier) {
    throw new Error('Subscription tier not found');
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { agencyId },
  });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [
      {
        price_data: {
          currency: 'usd',
          product: tier.name,
          unit_amount: Math.round(Number(tier.monthlyPrice) * 100),
          recurring: {
            interval: 'month',
            interval_count: 1,
          },
        },
      },
    ],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  });

  const subscriptionRecord = (subscription as unknown) as Record<string, unknown>;
  const currentPeriodEnd = subscriptionRecord.current_period_end as number;

  const stripeSubscription = await db.stripeSubscription.create({
    data: {
      agencyId,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: new Date(currentPeriodEnd * 1000),
      status: subscription.status,
    },
  });

  const invoiceRecord = ((subscription.latest_invoice as unknown) as Record<string, unknown>) || {};
  const paymentIntentRecord = (invoiceRecord.payment_intent as Record<string, unknown>) || {};
  const clientSecret = (paymentIntentRecord.client_secret as string) || null;

  return {
    subscription: stripeSubscription,
    clientSecret,
  };
}

export async function handleInvoicePaid(invoiceId: string, subscriptionId: string) {
  const stripe = getStripeClient();

  const invoice = await stripe.invoices.retrieve(invoiceId);

  const stripeSubscription = await db.stripeSubscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    include: { agency: true },
  });

  if (!stripeSubscription) {
    throw new Error('Subscription not found');
  }

  const invoiceRecord = (invoice as unknown) as Record<string, unknown>;
  const periodEnd = invoiceRecord.period_end as number;

  await db.stripeSubscription.update({
    where: { id: stripeSubscription.id },
    data: {
      status: 'active',
      graceUntil: null,
      lastInvoiceId: invoiceId,
      lastInvoiceStatus: 'paid',
      currentPeriodEnd: new Date(periodEnd * 1000),
    },
  });

  console.log(`[Stripe] Invoice ${invoiceId} paid for agency ${stripeSubscription.agencyId}`);
}

export async function handlePaymentFailed(invoiceId: string, subscriptionId: string) {
  const stripe = getStripeClient();
  const _invoice = await stripe.invoices.retrieve(invoiceId);

  const stripeSubscription = await db.stripeSubscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    include: { agency: true },
  });

  if (!stripeSubscription) {
    throw new Error('Subscription not found');
  }

  const graceUntil = new Date();
  graceUntil.setDate(graceUntil.getDate() + 7);

  await db.stripeSubscription.update({
    where: { id: stripeSubscription.id },
    data: {
      status: 'grace_period',
      graceUntil,
      lastInvoiceId: invoiceId,
      lastInvoiceStatus: 'failed',
    },
  });

  console.log(
    `[Stripe] Payment failed for agency ${stripeSubscription.agencyId}. Grace period until ${graceUntil.toISOString()}`
  );
}

export async function handleSubscriptionDeleted(subscriptionId: string) {
  const stripeSubscription = await db.stripeSubscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (!stripeSubscription) {
    throw new Error('Subscription not found');
  }

  await db.stripeSubscription.update({
    where: { id: stripeSubscription.id },
    data: { status: 'canceled' },
  });

  console.log(`[Stripe] Subscription ${subscriptionId} canceled`);
}