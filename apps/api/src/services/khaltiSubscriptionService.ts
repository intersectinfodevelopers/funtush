import { db } from '@funtush/database';
import { generateKhaltiPayload, verifyKhaltiPayment } from '../utils/khalti';

export async function initiateKhaltiPayment(
  agencyId: string,
  subscriptionTierId: string
) {
  const tier = await db.subscriptionTier.findUnique({
    where: { id: subscriptionTierId },
  });

  if (!tier) {
    throw new Error('Subscription tier not found');
  }

  const payload = generateKhaltiPayload(
    agencyId,
    Number(tier.monthlyPrice),
    subscriptionTierId
  );

  // Store pending transaction
  const transaction = await db.khaltiTransaction.create({
    data: {
      agencyId,
      tierId: subscriptionTierId,
      amount: Number(tier.monthlyPrice),
      status: 'pending',
    },
  });

  return {
    transactionId: transaction.id,
    khaltiPayload: payload,
  };
}

export async function verifyAndCompleteKhaltiPayment(
  token: string,
  transactionId: string,
  agencyId: string
) {
  const transaction = await db.khaltiTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  const isValid = await verifyKhaltiPayment(token, transaction.amount * 100);

  if (!isValid) {
    await db.khaltiTransaction.update({
      where: { id: transactionId },
      data: { status: 'failed' },
    });
    throw new Error('Khalti payment verification failed');
  }

  // Update transaction
  await db.khaltiTransaction.update({
    where: { id: transactionId },
    data: {
      status: 'success',
      khaltiToken: token,
      verifiedAt: new Date(),
    },
  });

  // Create/update subscription
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  // Update agency tier
  await db.agency.update({
    where: { id: agencyId },
    data: { tierId: transaction.tierId },
  });

  return transaction;
}