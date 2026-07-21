import { Router, Request, Response } from 'express';
import { emergencyService } from '../services/emergencyService';

const sosRoutes = Router();

sosRoutes.post('/trigger', async (req: Request, res: Response) => {
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
      guiderId: guiderId || req.user?.id,
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

sosRoutes.post('/:sosId/cancel', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    await emergencyService.cancelSOS(req.params.sosId, reason);

    res.json({ success: true, message: 'SOS cancelled' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel SOS';
    res.status(500).json({ error: message });
  }
});

export default sosRoutes;