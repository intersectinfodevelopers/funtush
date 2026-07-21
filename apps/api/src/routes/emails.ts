import express from 'express';
import { emailService } from '../services/emailService';
import { authenticate } from '../middleware/auth';

const router = express.Router();

/**
 * POST /api/emails/inquiry-received
 */
router.post('/inquiry-received', authenticate, async (req, res) => {
  try {
    const { to, firstName, trekName, inquiryId, trackingUrl } = req.body;

    const result = await emailService.sendInquiryReceived(to, {
      firstName,
      trekName,
      inquiryId,
      trackingUrl,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Email send failed',
    });
  }
});

/**
 * POST /api/emails/booking-confirmed
 */
router.post('/booking-confirmed', authenticate, async (req, res) => {
  try {
    const {
      to,
      firstName,
      bookingId,
      trekName,
      startDate,
      duration,
      guide,
      itineraryPdfUrl,
      dashboardUrl,
      totalPrice,
    } = req.body;

    const result = await emailService.sendBookingConfirmed(to, {
      firstName,
      bookingId,
      trekName,
      startDate,
      duration,
      guide,
      itineraryPdfUrl,
      dashboardUrl,
      totalPrice,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Email send failed' });
  }
});

// Similar routes for other email types...

export default router;