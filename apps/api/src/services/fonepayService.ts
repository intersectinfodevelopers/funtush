import { db } from '@funtush/database';
import { generateDynamicQRCode, verifyFonepayTransaction } from '../utils/fonepay';

export async function activateFonepay(agencyId: string) {
  // Check KYC approval - NOTE: 'kycSubmission' (lowercase k)
  const kycSubmission = await db.kycSubmission.findUnique({
    where: { agencyId },
  });

  if (!kycSubmission || kycSubmission.status !== 'APPROVED') {
    throw new Error('Fonepay activation requires KYC APPROVED status');
  }

  // Get agency
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  // Get fee for tier - NOTE: 'transactionFee' (all lowercase after 'transaction')
  const transactionFee = await db.transactionFee.findUnique({
    where: { tierId: agency.tierId },
  });

  if (!transactionFee) {
    throw new Error('Transaction fee not configured for tier');
  }

  // Generate static QR code
  const qrUrl = await generateDynamicQRCode(agencyId, 0);

  // Create or update QR record - NOTE: 'fonepayQRCode' (capital Q, C)
  const qrCode = await db.fonepayQRCode.upsert({
    where: { agencyId },
    update: {
      qrCodeUrl: qrUrl,
      isActive: true,
      qrType: 'static',
      updatedAt: new Date(),
    },
    create: {
      agencyId,
      qrCodeUrl: qrUrl,
      qrType: 'static',
      isActive: true,
    },
  });

  return {
    qrCode,
    feePercentage: transactionFee.feePercentage,
    message: 'Fonepay activated successfully',
  };
}

export async function generateDynamicQR(agencyId: string, amount: number) {
  // Check if Fonepay is activated
  const qrCode = await db.fonepayQRCode.findUnique({
    where: { agencyId },
  });

  if (!qrCode || !qrCode.isActive) {
    throw new Error('Fonepay not activated for this agency');
  }

  // Generate dynamic QR for specific amount
  const dynamicQrUrl = await generateDynamicQRCode(agencyId, amount);

  return {
    qrUrl: dynamicQrUrl,
    amount,
  };
}

export async function processAndVerifyFonepayTransaction(
  agencyId: string,
  trekkerEmail: string,
  bookingId: string | null,
  transactionId: string,
  amount: number
) {
  // Check if agency has Fonepay activated
  const qrCode = await db.fonepayQRCode.findUnique({
    where: { agencyId },
  });

  if (!qrCode || !qrCode.isActive) {
    throw new Error('Fonepay not activated for this agency');
  }

  // Get agency and fee
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  const transactionFee = await db.transactionFee.findUnique({
    where: { tierId: agency.tierId },
  });

  if (!transactionFee) {
    throw new Error('Transaction fee not configured');
  }

  // Calculate fees
  const feeAmount = amount * (transactionFee.feePercentage / 100);
  const netAmount = amount - feeAmount;

  // Verify transaction with Fonepay
  const isValid = await verifyFonepayTransaction(transactionId, amount);

  if (!isValid) {
    throw new Error('Fonepay transaction verification failed');
  }

  // Create transaction record - NOTE: 'fonepayTransaction' (lowercase f)
  const transaction = await db.fonepayTransaction.create({
    data: {
      agencyId,
      trekkerEmail,
      bookingId: bookingId || null,
      amount,
      feePercentage: transactionFee.feePercentage,
      feeAmount,
      netAmount,
      transactionId,
      status: 'success',
      verifiedAt: new Date(),
    },
  });

  return transaction;
}

export async function getFonepayStatus(agencyId: string) {
  const qrCode = await db.fonepayQRCode.findUnique({
    where: { agencyId },
  });

  if (!qrCode) {
    return {
      isActivated: false,
      qrUrl: null,
      feePercentage: null,
    };
  }

  const agency = await db.agency.findUnique({
    where: { id: agencyId },
  });

  const transactionFee = await db.transactionFee.findUnique({
    where: { tierId: agency?.tierId || '' },
  });

  return {
    isActivated: qrCode.isActive,
    qrUrl: qrCode.qrCodeUrl,
    qrType: qrCode.qrType,
    feePercentage: transactionFee?.feePercentage || null,
  };
}
