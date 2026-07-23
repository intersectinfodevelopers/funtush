import { db } from '@funtush/database';
import { initiateConnectIPSTransfer, checkConnectIPSStatus } from '../utils/connectIPS';

export async function initiateConnectIPSPayment(
  agencyId: string,
  subscriptionTierId: string,
  bankCode: string,
  accountNumber: string
) {
  const tier = await db.subscriptionTier.findUnique({
    where: { id: subscriptionTierId },
  });

  if (!tier) {
    throw new Error('Subscription tier not found');
  }

  const transfer = await initiateConnectIPSTransfer(
    agencyId,
    Number(tier.monthlyPrice),
    bankCode,
    accountNumber
  );

  const transaction = await db.connectIPSTransaction.create({
    data: {
      agencyId,
      tierId: subscriptionTierId,
      amount: Number(tier.monthlyPrice),
      transferId: transfer.transferId,
      status: transfer.status,
      bankCode,
      accountNumber,
    },
  });

  return transaction;
}

export async function checkAndUpdateConnectIPSPayment(transferId: string) {
  const transaction = await db.connectIPSTransaction.findUnique({
    where: { transferId },
  });

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  const status = await checkConnectIPSStatus(transferId);

  if (status === 'SUCCESS') {
    await db.connectIPSTransaction.update({
      where: { id: transaction.id },
      data: {
        status: 'success',
        verifiedAt: new Date(),
      },
    });

    await db.agency.update({
      where: { id: transaction.agencyId },
      data: { tierId: transaction.tierId },
    });
  } else if (status === 'FAILED') {
    await db.connectIPSTransaction.update({
      where: { id: transaction.id },
      data: { status: 'failed' },
    });
  }

  return transaction;
}