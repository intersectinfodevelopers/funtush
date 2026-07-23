import { Router, Request, Response } from 'express';
import { emailService } from '../services/emailService';

const emailRoutes = Router();

// ===== EXISTING ROUTES =====

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

// ===== DAY 4 NEW ROUTES =====

emailRoutes.post('/welcome', async (req: Request, res: Response) => {
  try {
    const { to, firstName, email, verificationUrl } = req.body;

    const result = await emailService.sendWelcomeEmail(to, {
      firstName,
      email,
      verificationUrl,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/kyc-submitted', async (req: Request, res: Response) => {
  try {
    const { to, firstName, submissionDate, referenceId } = req.body;

    const result = await emailService.sendKYCSubmittedEmail(to, {
      firstName,
      submissionDate,
      referenceId,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/kyc-approved', async (req: Request, res: Response) => {
  try {
    const { to, firstName, approvalDate } = req.body;

    const result = await emailService.sendKYCApprovedEmail(to, {
      firstName,
      approvalDate,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/kyc-rejected', async (req: Request, res: Response) => {
  try {
    const { to, firstName, reason, resubmitUrl } = req.body;

    const result = await emailService.sendKYCRejectedEmail(to, {
      firstName,
      reason,
      resubmitUrl,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/payment-confirmation', async (req: Request, res: Response) => {
  try {
    const {
      to,
      firstName,
      transactionId,
      amount,
      date,
      invoiceUrl,
      description,
    } = req.body;

    const result = await emailService.sendPaymentConfirmationEmail(to, {
      firstName,
      transactionId,
      amount,
      date,
      invoiceUrl,
      description,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/renewal-reminder', async (req: Request, res: Response) => {
  try {
    const {
      to,
      firstName,
      subscriptionType,
      expiryDate,
      daysRemaining,
      renewalUrl,
    } = req.body;

    const result = await emailService.sendRenewalReminderEmail(to, {
      firstName,
      subscriptionType,
      expiryDate,
      daysRemaining,
      renewalUrl,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/payment-failed', async (req: Request, res: Response) => {
  try {
    const { to, firstName, amount, reason, retryUrl, attemptDate } = req.body;

    const result = await emailService.sendPaymentFailedEmail(to, {
      firstName,
      amount,
      reason,
      retryUrl,
      attemptDate,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/breakglass-initiated', async (req: Request, res: Response) => {
  try {
    const { to, firstName, incidentType, timestamp, location, statusUrl } = req.body;

    const result = await emailService.sendBreakGlassInitiatedEmail(to, {
      firstName,
      incidentType,
      timestamp,
      location,
      statusUrl,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/breakglass-closed', async (req: Request, res: Response) => {
  try {
    const { to, firstName, incidentType, resolution, closedTime } = req.body;

    const result = await emailService.sendBreakGlassClosedEmail(to, {
      firstName,
      incidentType,
      resolution,
      closedTime,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/bug-status-changed', async (req: Request, res: Response) => {
  try {
    const { to, firstName, bugId, title, oldStatus, newStatus, changeTime } =
      req.body;

    const result = await emailService.sendBugStatusChangedEmail(to, {
      firstName,
      bugId,
      title,
      oldStatus,
      newStatus,
      changeTime,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/ad-campaign-decision', async (req: Request, res: Response) => {
  try {
    const { to, firstName, campaignName, status, feedback, decisionDate } =
      req.body;

    const result = await emailService.sendAdCampaignDecisionEmail(to, {
      firstName,
      campaignName,
      status: status as 'APPROVED' | 'REJECTED',
      feedback,
      decisionDate,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/safety-warning', async (req: Request, res: Response) => {
  try {
    const { to, firstName, warningType, severity, description, actionRequired, timestamp } =
      req.body;

    const result = await emailService.sendSafetyWarningEmail(to, {
      firstName,
      warningType,
      severity: severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      description,
      actionRequired,
      timestamp,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    res.status(500).json({ error: message });
  }
});

emailRoutes.post('/trek-start-reminder', async (req: Request, res: Response) => {
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

    const result = await emailService.sendTrekStartReminderEmail(to, {
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

export default emailRoutes;