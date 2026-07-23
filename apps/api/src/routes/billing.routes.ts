import { Router } from 'express';
import { authenticateWithRefreshToken } from 'src/middleware/refreshTokenAuthentication';
import { checkAgencyStatus } from 'src/middleware/agencyAccess.middleware';
import { db } from '@funtush/database';
import { createStripeSubscription } from '../services/stripeSubscriptionService';
import type { AgencyRequest } from '../types/auth-request';

const router = Router();

// POST /billing/subscribe
router.post(
  '/subscribe',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { subscriptionTierId } = req.body;
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      if (!subscriptionTierId) {
        return res.status(400).json({ error: 'Subscription tier ID is required' });
      }

      // Get agency email
      const agency = await db.agency.findUnique({
        where: { id: agencyId },
      });

      if (!agency) {
        return res.status(404).json({ error: 'Agency not found' });
      }

      // Create Stripe subscription
      const result = await createStripeSubscription(agencyId, agency.email, subscriptionTierId);

      res.json({
        subscriptionId: result.subscription.id,
        clientSecret: result.clientSecret,
      });
    } catch (err) {
      console.error('Subscription creation error:', err);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  }
);

router.post(
  '/subscribe/verify',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { provider, token, refId, transferId, transactionId } = req.body;
      const agencyId = req.agencyId;

      if (!agencyId || !provider) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      let result;

      switch (provider.toLowerCase()) {
        case 'khalti': {
          const { verifyAndCompleteKhaltiPayment } = await import(
            '../services/khaltiSubscriptionService'
          );
          result = await verifyAndCompleteKhaltiPayment(token, transactionId, agencyId);
          break;
        }

        case 'esewa': {
          const { verifyAndCompleteEsewaPayment } = await import(
            '../services/esewaSubscriptionService'
          );
          result = await verifyAndCompleteEsewaPayment(refId, transactionId, agencyId);
          break;
        }

        case 'connectips': {
          const { checkAndUpdateConnectIPSPayment } = await import(
            '../services/connectIPSService'
          );
          result = await checkAndUpdateConnectIPSPayment(transferId);
          break;
        }

        default:
          return res.status(400).json({ error: 'Invalid payment provider' });
      }

      // Log verification
      await db.nepaliPaymentVerification.create({
        data: {
          agencyId,
          provider,
          transactionId: result.id,
          status: result.status,
          verifiedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: 'Payment verified successfully',
        transaction: result,
      });
    } catch (err) {
      console.error('Payment verification error:', err);
      res.status(500).json({ error: 'Payment verification failed' });
    }
  }
);

// POST /billing/subscribe/khalti/initiate
router.post(
  '/subscribe/khalti/initiate',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { subscriptionTierId } = req.body;
      const agencyId = req.agencyId;

      if (!agencyId || !subscriptionTierId) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { initiateKhaltiPayment } = await import(
        '../services/khaltiSubscriptionService'
      );
      const result = await initiateKhaltiPayment(agencyId, subscriptionTierId);

      res.json(result);
    } catch (err) {
      console.error('Khalti initiate error:', err);
      res.status(500).json({ error: 'Failed to initiate Khalti payment' });
    }
  }
);

// POST /billing/subscribe/esewa/initiate
router.post(
  '/subscribe/esewa/initiate',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { subscriptionTierId } = req.body;
      const agencyId = req.agencyId;

      if (!agencyId || !subscriptionTierId) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { initiateEsewaPayment } = await import(
        '../services/esewaSubscriptionService'
      );
      const result = await initiateEsewaPayment(agencyId, subscriptionTierId);

      res.json(result);
    } catch (err) {
      console.error('eSewa initiate error:', err);
      res.status(500).json({ error: 'Failed to initiate eSewa payment' });
    }
  }
);

// POST /billing/subscribe/connectips/initiate
router.post(
  '/subscribe/connectips/initiate',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { subscriptionTierId, bankCode, accountNumber } = req.body;
      const agencyId = req.agencyId;

      if (!agencyId || !subscriptionTierId || !bankCode || !accountNumber) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { initiateConnectIPSPayment } = await import(
        '../services/connectIPSService'
      );
      const result = await initiateConnectIPSPayment(
        agencyId,
        subscriptionTierId,
        bankCode,
        accountNumber
      );

      res.json(result);
    } catch (err) {
      console.error('ConnectIPS initiate error:', err);
      res.status(500).json({ error: 'Failed to initiate ConnectIPS payment' });
    }
  }
);

// POST /agencies/me/payment-methods/fonepay/activate
router.post(
  '/fonepay/activate',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { activateFonepay } = await import(
        '../services/fonepayService'
      );
      const result = await activateFonepay(agencyId);

      res.json(result);
    } catch (err) {
      console.error('Fonepay activation error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Fonepay activation failed',
      });
    }
  }
);

// POST /agencies/me/payment-methods/fonepay/qr/dynamic
router.post(
  '/fonepay/qr/dynamic',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { amount } = req.body;
      const agencyId = req.agencyId;

      if (!agencyId || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { generateDynamicQR } = await import(
        '../services/fonepayService'
      );
      const result = await generateDynamicQR(agencyId, amount);

      res.json(result);
    } catch (err) {
      console.error('Dynamic QR generation error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'QR generation failed',
      });
    }
  }
);

// GET /agencies/me/payment-methods/fonepay/status
router.get(
  '/fonepay/status',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { getFonepayStatus } = await import(
        '../services/fonepayService'
      );
      const status = await getFonepayStatus(agencyId);

      res.json(status);
    } catch (err) {
      console.error('Fonepay status error:', err);
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  }
);

// POST /trekker/payment/fonepay/verify (no auth - trekker facing)
router.post(
  '/fonepay/verify',
  async (req, res) => {
    try {
      const { agencyId, trekkerEmail, bookingId, transactionId, amount } =
        req.body;

      if (!agencyId || !trekkerEmail || !transactionId || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { processAndVerifyFonepayTransaction } = await import(
        '../services/fonepayService'
      );
      const transaction = await processAndVerifyFonepayTransaction(
        agencyId,
        trekkerEmail,
        bookingId || null,
        transactionId,
        amount
      );

      res.json({
        success: true,
        message: 'Payment verified successfully',
        transaction,
      });
    } catch (err) {
      console.error('Payment verification error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Payment verification failed',
      });
    }
  }
);

export default router;