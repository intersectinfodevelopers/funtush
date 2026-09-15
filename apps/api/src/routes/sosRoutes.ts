import { Router, Request, Response } from 'express';
import { requireAuth } from '@funtush/auth';
import { emergencyService } from '../services/emergencyService';

const sosRoutes = Router();

/**
 * SECURITY FIX: both routes previously had **no auth at all** — mounted
 * with zero middleware, anyone could anonymously fake-trigger a
 * life-safety emergency alert, or worse, cancel a real one for a trekker
 * actually in danger. Per `mobile.routes.ts`'s own documented convention
 * for SOS (Backend Guide §10) — `requireAuth`, no `requireRole` — every
 * signed-in role (trekker, guide, agency staff) has an equally legitimate
 * reason to trigger/cancel, so this only asks "is this a real, signed-in
 * session", matching that established rule rather than inventing a
 * narrower one.
 */
/**
 * @openapi
 * /sos/trigger:
 *   post:
 *     tags: [SOS]
 *     summary: Trigger an emergency SOS alert for a trek
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Activated }, 400: { description: trekId/sosType/location required } }
 * /sos/{sosId}/cancel:
 *   post:
 *     tags: [SOS]
 *     summary: Cancel an active SOS alert with a reason
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: sosId, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Cancelled }, 400: { description: reason required } }
 */
sosRoutes.post('/trigger', requireAuth, async (req: Request, res: Response) => {
  try {
    const { trekId, sosType, location, notes, guiderId, trekkerIds } =
      req.body;

    if (!trekId || !sosType || !location) {
      return res.status(400).json({
        error: 'trekId, sosType, and location are required',
      });
    }

    await emergencyService.triggerSOS({
      trekId,
      guiderId: guiderId || req.user?.userId,
      trekkerIds: trekkerIds || [],
      sosType,
      location,
      notes,
    });

    res.json({
      success: true,
      message: 'SOS activated. Emergency services notified.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SOS trigger failed';
    res.status(500).json({ error: message });
  }
});

sosRoutes.post('/:sosId/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const sosId = Array.isArray(req.params.sosId) ? req.params.sosId[0] : req.params.sosId;
    await emergencyService.cancelSOS(sosId, reason);

    res.json({ success: true, message: 'SOS cancelled' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel SOS';
    res.status(500).json({ error: message });
  }
});

export default sosRoutes;