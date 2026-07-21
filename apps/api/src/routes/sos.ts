import express from 'express';
import { emergencyService } from '../services/emergencyService';
import { authenticate } from '../middleware/auth';

const router = express.Router();

/**
 * POST /api/sos/trigger
 * Trigger SOS event
 */
router.post('/trigger', authenticate, async (req, res) => {
  try {
    const { trekId, sosType, location, notes } = req.body;
    const userId = req.user.id;

    // Validate guide is on trek
    const trek = await db.treks.findById(trekId);
    if (trek.guideId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Trigger SOS
    await emergencyService.triggerSOS({
      trekId,
      guiderId: userId,
      trekkerIds: trek.trekkerIds,
      sosType,
      location,
      notes,
    });

    res.json({
      success: true,
      message: 'SOS activated. Emergency services notified.',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'SOS trigger failed',
    });
  }
});

/**
 * POST /api/sos/:sosId/cancel
 * Cancel active SOS
 */
router.post('/:sosId/cancel', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;

    await emergencyService.cancelSOS(req.params.sosId, reason);

    res.json({ success: true, message: 'SOS cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel SOS' });
  }
});

export default router;