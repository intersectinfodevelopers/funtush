// import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
// import { db } from '@funtush/database';

// // Mock all payment utils
// vi.mock('src/utils/khalti');
// vi.mock('src/utils/esewa');
// vi.mock('src/utils/connectIPS');
// vi.mock('src/utils/fonepay');

// import {
//   initiateKhaltiPayment,
//   verifyAndCompleteKhaltiPayment,
// } from 'src/services/khaltiSubscriptionService';
// import {
//   initiateEsewaPayment,
//   verifyAndCompleteEsewaPayment,
// } from 'src/services/esewaSubscriptionService';
// import {
//   initiateConnectIPSPayment,
//   checkAndUpdateConnectIPSPayment,
// } from 'src/services/connectIPSService';
// import {
//   activateFonepay,
//   generateDynamicQR,
//   processAndVerifyFonepayTransaction,
// } from 'src/services/fonepayService';

// describe('Payment Integration - All Providers', () => {
//   // Test data
//   const mockAgencyId = 'agency_payment_test_' + Date.now();
//   const mockTierId = 'tier_large_test_' + Date.now();
//   const mockAmount = 1000;

//   // Setup: Create all required database records
//   beforeAll(async () => {
//     // Create subscription tier with ALL required fields
//     await db.subscriptionTier.create({
//       data: {
//         id: mockTierId,
//         name: 'Large Test Tier',
//         monthlyPrice: mockAmount,
//         maxStaff: 10, // REQUIRED
//         maxAgencies: 5, // Include if required
//         features: JSON.stringify(['feature1', 'feature2']), // Include if required
//       },
//     });

//     // Create agency
//     await db.agency.create({
//       data: {
//         id: mockAgencyId,
//         email: 'test@agency.com',
//         name: 'Test Agency',
//         tierId: mockTierId,
//       },
//     });

//     // FIX: Changed kYCSubmission → kycSubmission (lowercase k)
//     await db.kycSubmission.create({
//       data: {
//         id: 'kyc_' + mockAgencyId,
//         agencyId: mockAgencyId,
//         status: 'APPROVED',
//         pancertificate: 'test.pdf',
//         businessRegistration: 'test.pdf',
//         tourismlicense: 'test.pdf',
//         bankdetails: 'test.pdf',
//       },
//     });

//     // Create transaction fee configuration
//     await db.transactionFee.create({
//       data: {
//         id: 'fee_' + mockTierId,
//         tierId: mockTierId,
//         feePercentage: 2.75,
//       },
//     });
//   });

//   afterEach(() => {
//     vi.clearAllMocks();
//   });

//   // Cleanup
//   afterAll(async () => {
//     // Delete in reverse dependency order
//     // FIX: Changed all kYCSubmission → kycSubmission
//     await db.fonepayTransaction.deleteMany({
//       where: { agencyId: mockAgencyId },
//     });
//     await db.khaltiTransaction.deleteMany({
//       where: { agencyId: mockAgencyId },
//     });
//     await db.esewaTransaction.deleteMany({
//       where: { agencyId: mockAgencyId },
//     });
//     await db.connectIPSTransaction.deleteMany({
//       where: { agencyId: mockAgencyId },
//     });
//     await db.fonepayQRCode.deleteMany({
//       where: { agencyId: mockAgencyId },
//     });
//     await db.transactionFee.deleteMany({
//       where: { tierId: mockTierId },
//     });
//     // FIX: kYCSubmission → kycSubmission
//     await db.kycSubmission.deleteMany({
//       where: { agencyId: mockAgencyId },
//     });
//     await db.agency.deleteMany({
//       where: { id: mockAgencyId },
//     });
//     await db.subscriptionTier.deleteMany({
//       where: { id: mockTierId },
//     });
//   });

//   describe('Khalti Payment', () => {
//     it('should initiate Khalti payment with tier pricing', async () => {
//       const result = await initiateKhaltiPayment(mockAgencyId, mockTierId);

//       expect(result).toHaveProperty('transactionId');
//       expect(result).toHaveProperty('khaltiPayload');
//       expect(result.khaltiPayload.amount).toBe(mockAmount * 100);
//       expect(result.khaltiPayload.product_name).toContain('Funtush');
//     });

//     it('should verify and complete Khalti payment', async () => {
//       const initResult = await initiateKhaltiPayment(mockAgencyId, mockTierId);
//       const transactionId = initResult.transactionId;

//       const verifyResult = await verifyAndCompleteKhaltiPayment(
//         'khalti_token_test',
//         transactionId,
//         mockAgencyId
//       );

//       expect(verifyResult.status).toBe('success');
//       expect(verifyResult.khaltiToken).toBe('khalti_token_test');
//       expect(verifyResult.verifiedAt).toBeDefined();
//     });

//     it('should fail Khalti verification with invalid token', async () => {
//       const { verifyKhaltiPayment } = await import('src/utils/khalti');
//       vi.mocked(verifyKhaltiPayment).mockResolvedValueOnce(false);

//       const initResult = await initiateKhaltiPayment(mockAgencyId, mockTierId);

//       await expect(
//         verifyAndCompleteKhaltiPayment(
//           'invalid_token',
//           initResult.transactionId,
//           mockAgencyId
//         )
//       ).rejects.toThrow('verification failed');
//     });
//   });

//   describe('eSewa Payment', () => {
//     it('should initiate eSewa payment with direct rupees', async () => {
//       const result = await initiateEsewaPayment(mockAgencyId, mockTierId);

//       expect(result).toHaveProperty('transactionId');
//       expect(result).toHaveProperty('esewaPayload');
//       expect(result.esewaPayload.amt).toBe(mockAmount);
//       expect(result.esewaPayload.scd).toBeDefined();
//     });

//     it('should verify and complete eSewa payment', async () => {
//       const initResult = await initiateEsewaPayment(mockAgencyId, mockTierId);
//       const transactionId = initResult.transactionId;

//       const verifyResult = await verifyAndCompleteEsewaPayment(
//         'esewa_ref_123',
//         transactionId,
//         mockAgencyId
//       );

//       expect(verifyResult.status).toBe('success');
//       expect(verifyResult.esewaRefId).toBe('esewa_ref_123');
//       expect(verifyResult.verifiedAt).toBeDefined();
//     });

//     it('should fail eSewa verification with invalid ref', async () => {
//       const { verifyEsewaPayment } = await import('src/utils/esewa');
//       vi.mocked(verifyEsewaPayment).mockResolvedValueOnce(false);

//       const initResult = await initiateEsewaPayment(mockAgencyId, mockTierId);

//       await expect(
//         verifyAndCompleteEsewaPayment(
//           'invalid_ref',
//           initResult.transactionId,
//           mockAgencyId
//         )
//       ).rejects.toThrow('verification failed');
//     });
//   });

//   describe('ConnectIPS Payment', () => {
//     it('should initiate ConnectIPS transfer with bank details', async () => {
//       const result = await initiateConnectIPSPayment(
//         mockAgencyId,
//         mockTierId,
//         'NABIL',
//         '1234567890'
//       );

//       expect(result).toHaveProperty('transferId');
//       expect(result.status).toBe('PENDING');
//       expect(result.bankCode).toBe('NABIL');
//       expect(result.accountNumber).toBe('1234567890');
//     });

//     it('should verify and update ConnectIPS transfer status', async () => {
//       const initResult = await initiateConnectIPSPayment(
//         mockAgencyId,
//         mockTierId,
//         'NABIL',
//         '1234567890'
//       );
//       const transferId = initResult.transferId;

//       const verifyResult = await checkAndUpdateConnectIPSPayment(transferId);

//       expect(verifyResult.status).toBe('success');
//       expect(verifyResult.verifiedAt).toBeDefined();
//     });

//     it('should handle failed ConnectIPS transfer', async () => {
//       const { checkConnectIPSStatus } = await import('src/utils/connectIPS');
//       vi.mocked(checkConnectIPSStatus).mockResolvedValueOnce('FAILED');

//       const initResult = await initiateConnectIPSPayment(
//         mockAgencyId,
//         mockTierId,
//         'NABIL',
//         '1234567890'
//       );

//       const verifyResult = await checkAndUpdateConnectIPSPayment(
//         initResult.transferId
//       );

//       expect(verifyResult.status).toBe('failed');
//     });
//   });

//   describe('Fonepay Payment', () => {
//     it('should activate Fonepay with KYC approval', async () => {
//       const result = await activateFonepay(mockAgencyId);

//       expect(result).toHaveProperty('qrCode');
//       expect(result.qrCode.isActive).toBe(true);
//       expect(result.qrCode.qrType).toBe('static');
//       expect(result.feePercentage).toBe(2.75);
//     });

//     it('should fail Fonepay activation without KYC approval', async () => {
//       const newAgencyId = 'agency_no_kyc_' + Date.now();

//       await db.agency.create({
//         data: {
//           id: newAgencyId,
//           email: 'no_kyc@agency.com',
//           name: 'No KYC Agency',
//           tierId: mockTierId,
//         },
//       });

//       await expect(activateFonepay(newAgencyId)).rejects.toThrow(
//         'KYC APPROVED'
//       );

//       await db.agency.delete({ where: { id: newAgencyId } });
//     });

//     it('should generate dynamic QR after activation', async () => {
//       await activateFonepay(mockAgencyId);

//       const result = await generateDynamicQR(mockAgencyId, 500);

//       expect(result).toHaveProperty('qrUrl');
//       expect(result.amount).toBe(500);
//     });

//     it('should fail dynamic QR if not activated', async () => {
//       const unactivatedAgencyId = 'agency_unactivated_' + Date.now();

//       await db.agency.create({
//         data: {
//           id: unactivatedAgencyId,
//           email: 'unactivated@agency.com',
//           name: 'Unactivated Agency',
//           tierId: mockTierId,
//         },
//       });

//       await expect(
//         generateDynamicQR(unactivatedAgencyId, 500)
//       ).rejects.toThrow('not activated');

//       await db.agency.delete({ where: { id: unactivatedAgencyId } });
//     });

//     it('should verify Fonepay transaction with correct fees', async () => {
//       await activateFonepay(mockAgencyId);

//       const result = await processAndVerifyFonepayTransaction(
//         mockAgencyId,
//         'trekker@test.com',
//         'booking_123',
//         'txn_fonepay_000',
//         1000
//       );

//       expect(result.status).toBe('success');
//       expect(result.amount).toBe(1000);
//       expect(result.feePercentage).toBe(2.75);
//       expect(result.feeAmount).toBeCloseTo(27.5, 1);
//       expect(result.netAmount).toBeCloseTo(972.5, 1);
//     });

//     it('should fail Fonepay verification if not activated', async () => {
//       const unactivatedAgencyId = 'agency_no_fonepay_' + Date.now();

//       await db.agency.create({
//         data: {
//           id: unactivatedAgencyId,
//           email: 'no_fonepay@agency.com',
//           name: 'No Fonepay Agency',
//           tierId: mockTierId,
//         },
//       });

//       await expect(
//         processAndVerifyFonepayTransaction(
//           unactivatedAgencyId,
//           'trekker@test.com',
//           null,
//           'txn_test',
//           1000
//         )
//       ).rejects.toThrow('not activated');

//       await db.agency.delete({ where: { id: unactivatedAgencyId } });
//     });
//   });

//   describe('Cross-Provider Fee Comparison', () => {
//     it('should apply correct fees across all providers', async () => {
//       const khaltiResult = await initiateKhaltiPayment(mockAgencyId, mockTierId);
//       expect(khaltiResult.khaltiPayload.amount).toBe(mockAmount * 100);

//       const esewaResult = await initiateEsewaPayment(mockAgencyId, mockTierId);
//       expect(esewaResult.esewaPayload.amt).toBe(mockAmount);

//       const connectipsResult = await initiateConnectIPSPayment(
//         mockAgencyId,
//         mockTierId,
//         'NABIL',
//         '1234567890'
//       );
//       expect(connectipsResult.amount).toBe(mockAmount);

//       await activateFonepay(mockAgencyId);
//       const fonepayResult = await processAndVerifyFonepayTransaction(
//         mockAgencyId,
//         'trekker@test.com',
//         null,
//         'txn_fee_test',
//         mockAmount
//       );
//       expect(fonepayResult.netAmount).toBeLessThan(mockAmount);
//     });
//   });
// });