import { Router } from 'express';
import { authenticateWithRefreshToken } from 'src/middleware/refreshTokenAuthentication';
import { checkAgencyStatus } from 'src/middleware/agencyAccess.middleware';
import { db } from '@funtush/database';
import { encryptCredentials } from '../utils/encryption';
import type { AgencyRequest } from '../types/auth-request';

const router = Router();

// POST /agencies/me/payment-methods
router.post(
  '/',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { provider, ...credentials } = req.body;
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      if (!provider) {
        return res.status(400).json({ error: 'Provider is required' });
      }

      const encryptedCreds = encryptCredentials(credentials);

      const paymentMethod = await db.agencyPaymentMethod.upsert({
        where: { agencyId_provider: { agencyId, provider } },
        update: {
          credentialsEncrypted: encryptedCreds,
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          agencyId,
          provider,
          credentialsEncrypted: encryptedCreds,
        },
      });

      //  Return without credentials
      res.json({
        id: paymentMethod.id,
        provider: paymentMethod.provider,
        isActive: paymentMethod.isActive,
        createdAt: paymentMethod.createdAt,
      });
    } catch (err) {
      console.error('Payment method save error:', err);
      res.status(500).json({ error: 'Failed to save payment method' });
    }
  }
);

// GET /agencies/me/payment-methods
router.get(
  '/',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const methods = await db.agencyPaymentMethod.findMany({
        where: { agencyId },
        select: {
          id: true,
          provider: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.json(methods);
    } catch (err) {
      console.error('Payment methods fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch payment methods' });
    }
  }
);

// PATCH /agencies/me/payment-methods/:id/toggle
router.patch(
  '/:id/toggle',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      if (!id) {
        return res.status(400).json({ error: 'Payment method ID is required' });
      }

      const method = await db.agencyPaymentMethod.findFirst({
        where: { id, agencyId },
      });

      if (!method) {
        return res.status(404).json({ error: 'Payment method not found' });
      }

      const updated = await db.agencyPaymentMethod.update({
        where: { id },
        data: { isActive: !method.isActive },
        select: {
          id: true,
          provider: true,
          isActive: true,
          updatedAt: true,
        },
      });

      res.json(updated);
    } catch (err) {
      console.error('Payment method update error:', err);
      res.status(500).json({ error: 'Failed to update payment method' });
    }
  }
);

export default router;