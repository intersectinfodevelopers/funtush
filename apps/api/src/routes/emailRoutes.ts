import { Router, Request, Response } from 'express';
import { emailService } from '../services/emailService';

const emailRoutes = Router();

emailRoutes.post('/inquiry-received', async (req: Request, res: Response) => {
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
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/booking-confirmed', async (req: Request, res: Response) => {
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
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/payment-link', async (req: Request, res: Response) => {
  try {
    const { to, firstName, bookingId, trekName, amount, paymentUrl, dueDate } =
      req.body;

    const result = await emailService.sendPaymentLink(to, {
      firstName,
      bookingId,
      trekName,
      amount,
      paymentUrl,
      dueDate,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/trek-reminder', async (req: Request, res: Response) => {
  try {
    const {
      to,
      firstName,
      trekName,
      startDate,
      departureTime,
      meetingLocation,
      guidePhone,
      checklist,
    } = req.body;

    const result = await emailService.sendTrekReminder(to, {
      firstName,
      trekName,
      startDate,
      departureTime,
      meetingLocation,
      guidePhone,
      checklist,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/guide-contact', async (req: Request, res: Response) => {
  try {
    const { to, trekkerName, trekName, guideName, guidePhone, guideEmail } =
      req.body;

    const result = await emailService.sendGuideContact(to, {
      trekkerName,
      trekName,
      guideName,
      guidePhone,
      guideEmail,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/review-invitation', async (req: Request, res: Response) => {
  try {
    const { to, firstName, trekName, completionDate, reviewUrl } = req.body;

    const result = await emailService.sendReviewInvitation(to, {
      firstName,
      trekName,
      completionDate,
      reviewUrl,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

export default emailRoutes;