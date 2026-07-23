import { db } from '@funtush/database';
import { generateEsewaPayload, verifyEsewaPayment } from '../utils/esewa';

export async function initiateEsewaPayment(
  agencyId: string,
  subscriptionTierId: string
) {
  const tier = await db.subscriptionTier.findUnique({
    where: { id: subscriptionTierId },
  });

  if (!tier) {
    throw new Error('Subscription tier not found');
  }

  const payload = generateEsewaPayload(
    agencyId,
    Number(tier.monthlyPrice),
    subscriptionTierId
  );

  const transaction = await db.esewaTransaction.create({
    data: {
      agencyId,
      tierId: subscriptionTierId,
      amount: Number(tier.monthlyPrice),
      status: 'pending',
    },
  });

  return {
    transactionId: transaction.id,
    esewaPayload: payload,
  };
}

export async function verifyAndCompleteEsewaPayment(
  refId: string,
  transactionId: string,
  agencyId: string
) {
  const transaction = await db.esewaTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  const isValid = await verifyEsewaPayment(refId, transaction.amount);

  if (!isValid) {
    await db.esewaTransaction.update({
      where: { id: transactionId },
      data: { status: 'failed' },
    });
    throw new Error('eSewa payment verification failed');
  }

  await db.esewaTransaction.update({
    where: { id: transactionId },
    data: {
      status: 'success',
      esewaRefId: refId,
      verifiedAt: new Date(),
    },
  });

  await db.agency.update({
    where: { id: agencyId },
    data: { tierId: transaction.tierId },
  });

  return transaction;
}