import { Router } from 'express';
import { authenticateWithRefreshToken } from 'src/middleware/refreshTokenAuthentication';
import { checkAgencyStatus } from 'src/middleware/agencyAccess.middleware';
import { db } from '@funtush/database';
import { encryptCredentials } from '../utils/encryption';
import type { AgencyRequest } from '../types/auth-request';

const router = Router();

/** Providers we can store credentials for, and the exact fields each needs. */
export const PROVIDER_FIELDS: Record<string, string[]> = {
  ESEWA: ['merchantId', 'secretKey'],
  KHALTI: ['publicKey', 'secretKey'],
  FONEPAY: ['merchantCode', 'terminalId'],
  STRIPE: ['publishableKey', 'secretKey'],
};

/** Returns an error message, or null when `provider` + `credentials` are well-formed. */
function checkCredentials(provider: unknown, credentials: Record<string, unknown>): string | null {
  if (typeof provider !== 'string' || !PROVIDER_FIELDS[provider]) {
    return `Provider must be one of ${Object.keys(PROVIDER_FIELDS).join(', ')}`;
  }
  const fields = PROVIDER_FIELDS[provider];
  for (const key of Object.keys(credentials)) if (!fields.includes(key)) return `Unknown field "${key}" for ${provider}`;
  for (const f of fields) {
    const v = credentials[f];
    if (typeof v !== 'string' || !v.trim()) return `${f} is required`;
    if (v.length > 500) return `${f} is too long`;
  }
  return null;
}

/**
 * @openapi
 * /agencies/me/payment-methods:
 *   post:
 *     tags: [Payment Methods]
 *     summary: Save (or replace) a payment provider's credentials, AES-256-GCM encrypted at rest
 *     security: [{ refreshToken: [] }]
 *     responses:
 *       200: { description: Saved — credentials never included in the response }
 *       400: { description: provider is required }
 *   get:
 *     tags: [Payment Methods]
 *     summary: List the agency's connected payment providers
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: Payment methods } }
 */
router.post(
  '/',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { provider: rawProvider, ...credentials } = req.body ?? {};
      const provider = typeof rawProvider === 'string' ? rawProvider.toUpperCase() : rawProvider;
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      if (!provider) {
        return res.status(400).json({ error: 'Provider is required' });
      }

      const problem = checkCredentials(provider, credentials);
      if (problem) return res.status(400).json({ error: problem });

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

/**
 * @openapi
 * /agencies/me/payment-methods/{id}/toggle:
 *   patch:
 *     tags: [Payment Methods]
 *     summary: Toggle a payment method active/inactive
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Toggled }
 *       404: { description: Not found (or belongs to a different agency) }
 */
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