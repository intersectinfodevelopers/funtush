import { Router, Request, Response } from 'express';
import { emailService } from '../services/emailService';
import { requireAdmin } from '../middleware/requireAdmin.middleware';

const emailRoutes = Router();

/**
 * Every one of these 18 routes previously had **no auth middleware at
 * all** — anyone could POST to `/emails/welcome`, `/emails/payment-
 * confirmation`, etc. with a fully attacker-controlled `to` address and
 * most of the template's other fields, turning this into an open,
 * unauthenticated relay for sending arbitrary transactional-looking email
 * from Funtush's own sending identity/provider. Nothing in this codebase
 * (backend or frontend) calls these routes over HTTP — every real trigger
 * (booking accepted, KYC approved, etc.) calls `emailService`'s functions
 * directly, in-process — so this file's only plausible legitimate use is a
 * manual admin ops tool for resending/testing a transactional email.
 * Gated the same way every other admin-only action in this codebase is.
 *
 * @openapi
 * /emails/inquiry-received:
 *   post: { tags: [Admin], summary: "Manually (re)send: inquiry received", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent }, 500: { description: Send failed } } }
 * /emails/booking-confirmed:
 *   post: { tags: [Admin], summary: "Manually (re)send: booking confirmed", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/payment-link:
 *   post: { tags: [Admin], summary: "Manually (re)send: payment link", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/trek-reminder:
 *   post: { tags: [Admin], summary: "Manually (re)send: trek reminder", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/guide-contact:
 *   post: { tags: [Admin], summary: "Manually (re)send: guide contact details", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/review-invitation:
 *   post: { tags: [Admin], summary: "Manually (re)send: review invitation", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/welcome:
 *   post: { tags: [Admin], summary: "Manually (re)send: welcome email", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/kyc-submitted:
 *   post: { tags: [Admin], summary: "Manually (re)send: KYC submitted", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/kyc-approved:
 *   post: { tags: [Admin], summary: "Manually (re)send: KYC approved", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/kyc-rejected:
 *   post: { tags: [Admin], summary: "Manually (re)send: KYC rejected", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/payment-confirmation:
 *   post: { tags: [Admin], summary: "Manually (re)send: payment confirmation", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/renewal-reminder:
 *   post: { tags: [Admin], summary: "Manually (re)send: subscription renewal reminder", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/payment-failed:
 *   post: { tags: [Admin], summary: "Manually (re)send: payment failed", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/breakglass-initiated:
 *   post: { tags: [Admin], summary: "Manually (re)send: break-glass access initiated", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/breakglass-closed:
 *   post: { tags: [Admin], summary: "Manually (re)send: break-glass access closed", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/bug-status-changed:
 *   post: { tags: [Admin], summary: "Manually (re)send: bug status changed", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/ad-campaign-decision:
 *   post: { tags: [Admin], summary: "Manually (re)send: ad campaign approved/rejected", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/safety-warning:
 *   post: { tags: [Admin], summary: "Manually (re)send: safety warning", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 * /emails/trek-start-reminder:
 *   post: { tags: [Admin], summary: "Manually (re)send: trek start reminder", security: [{ bearerAuth: [] }], responses: { 200: { description: Sent } } }
 */
emailRoutes.use(requireAdmin);

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