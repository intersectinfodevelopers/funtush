import { Resend } from 'resend';

interface EmailTemplateData {
  [key: string]: string | number | boolean | Record<string, unknown>;
}

interface EmailOptions {
  to: string | string[];
  subject: string;
  template: string;
  data: EmailTemplateData;
  replyTo?: string;
  priority?: 'HIGH' | 'NORMAL';
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
}

class EmailService {
  private resend: Resend | null;
  private fromEmail: string;
  private brandName: string;
  private brandUrl: string;
  private isTestMode: boolean;

  constructor() {
    this.isTestMode = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

    this.fromEmail = process.env.SENDINGDOMAIN_EMAIL || 'noreply@funtush.com';
    this.brandName = process.env.BRAND_NAME || 'Funtush';
    this.brandUrl = process.env.BRAND_URL || 'https://funtush.com';

    const apiKey = process.env.RESEND_API_KEY;

    if (apiKey) {
      try {
        this.resend = new Resend(apiKey);
        console.log('[EMAIL] Resend client initialized successfully');
      } catch (_error) {
        console.warn('[EMAIL] Failed to initialize Resend client:', _error instanceof Error ? _error.message : String(_error));
        this.resend = null;
      }
    } else {
      console.warn('[EMAIL] RESEND_API_KEY not configured. Running in mock mode.');
      this.resend = null;
    }
  }

  async send(options: EmailOptions): Promise<EmailResult> {
    try {
      const htmlContent = this.getTemplateHTML(options.template, options.data);

      if (!this.resend || this.isTestMode) {
        const toAddresses = Array.isArray(options.to) ? options.to.join(', ') : options.to;
        console.log(`[EMAIL MOCK] ${options.template} → ${toAddresses}`);
        return {
          success: true,
          messageId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
        };
      }

      const response = await this.resend.emails.send({
        from: `${this.brandName} <${this.fromEmail}>`,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: htmlContent,
        replyTo: options.replyTo,
      });

      if (response.error) {
        console.error(`[EMAIL FAILED] ${options.template}:`, response.error);
        return {
          success: false,
          error: response.error.message,
          timestamp: new Date(),
        };
      }

      console.log(
        `[EMAIL SENT] ${options.template} → ${options.to} (${response.data?.id})`
      );

      return {
        success: true,
        messageId: response.data?.id,
        timestamp: new Date(),
      };
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      console.error(`[EMAIL ERROR] ${options.template}:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  // ===== EXISTING METHODS (DAYS 1-3) =====

  async sendInquiryReceived(
    to: string,
    data: {
      firstName: string;
      trekName: string;
      inquiryId: string;
      trackingUrl: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Your ${data.trekName} inquiry has been received`,
      template: 'inquiry-received',
      data,
      priority: 'NORMAL',
    });
  }

  async sendBookingConfirmed(
    to: string,
    data: {
      firstName: string;
      bookingId: string;
      trekName: string;
      startDate: string;
      duration: string;
      guide: string;
      itineraryPdfUrl: string;
      dashboardUrl: string;
      totalPrice: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Booking confirmed: ${data.trekName}`,
      template: 'booking-confirmed',
      data,
      priority: 'HIGH',
    });
  }

  async sendPaymentLink(
    to: string,
    data: {
      firstName: string;
      bookingId: string;
      trekName: string;
      amount: string;
      paymentUrl: string;
      dueDate: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Payment required for ${data.trekName}`,
      template: 'payment-link',
      data,
      priority: 'HIGH',
    });
  }

  async sendTrekReminder(
    to: string,
    data: {
      firstName: string;
      trekName: string;
      startDate: string;
      departureTime: string;
      meetingLocation: string;
      guidePhone: string;
      checklist: string[];
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Trek reminder: ${data.trekName} starts in 48 hours`,
      template: 'trek-reminder',
      data,
      priority: 'HIGH',
    });
  }

  async sendGuideContact(
    to: string,
    data: {
      trekkerName: string;
      trekName: string;
      guideName: string;
      guidePhone: string;
      guideEmail: string;
      guidePhoto?: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Meet your guide for ${data.trekName}: ${data.guideName}`,
      template: 'guide-contact',
      data,
      priority: 'NORMAL',
    });
  }

  async sendReviewInvitation(
    to: string,
    data: {
      firstName: string;
      trekName: string;
      completionDate: string;
      reviewUrl: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Share your ${data.trekName} experience`,
      template: 'review-invitation',
      data,
      priority: 'NORMAL',
    });
  }

  async sendSOSNotification(
    to: string | string[],
    data: {
      sosType: string;
      location: string;
      trekName: string;
      guideName: string;
      timestamp: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `SOS Alert: ${data.trekName}`,
      template: 'sos-notification',
      data,
      priority: 'HIGH',
      replyTo: process.env.EMERGENCY_EMAIL,
    });
  }

  // ===== DAY 4 NEW METHODS =====

  async sendWelcomeEmail(
    to: string,
    data: {
      firstName: string;
      email: string;
      verificationUrl: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: 'Welcome to Funtush',
      template: 'welcome',
      data,
      priority: 'HIGH',
    });
  }

  async sendKYCSubmittedEmail(
    to: string,
    data: {
      firstName: string;
      submissionDate: string;
      referenceId: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: 'KYC Verification Submitted',
      template: 'kyc-submitted',
      data,
      priority: 'NORMAL',
    });
  }

  async sendKYCApprovedEmail(
    to: string,
    data: {
      firstName: string;
      approvalDate: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: 'KYC Verification Approved',
      template: 'kyc-approved',
      data,
      priority: 'HIGH',
    });
  }

  async sendKYCRejectedEmail(
    to: string,
    data: {
      firstName: string;
      reason: string;
      resubmitUrl: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: 'KYC Verification - Action Required',
      template: 'kyc-rejected',
      data,
      priority: 'HIGH',
    });
  }

  async sendPaymentConfirmationEmail(
    to: string,
    data: {
      firstName: string;
      transactionId: string;
      amount: string;
      date: string;
      invoiceUrl: string;
      description: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: 'Payment Confirmed',
      template: 'payment-confirmation',
      data,
      priority: 'HIGH',
    });
  }

  async sendRenewalReminderEmail(
    to: string,
    data: {
      firstName: string;
      subscriptionType: string;
      expiryDate: string;
      daysRemaining: number;
      renewalUrl: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Subscription Renewal Reminder - ${data.daysRemaining} days left`,
      template: 'renewal-reminder',
      data,
      priority: 'NORMAL',
    });
  }

  async sendPaymentFailedEmail(
    to: string,
    data: {
      firstName: string;
      amount: string;
      reason: string;
      retryUrl: string;
      attemptDate: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: 'Payment Failed - Action Required',
      template: 'payment-failed',
      data,
      priority: 'HIGH',
    });
  }

  async sendBreakGlassInitiatedEmail(
    to: string | string[],
    data: {
      firstName: string;
      incidentType: string;
      timestamp: string;
      location: string;
      statusUrl: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: 'EMERGENCY: Break-Glass Activated',
      template: 'breakglass-initiated',
      data,
      priority: 'HIGH',
      replyTo: process.env.EMERGENCY_EMAIL,
    });
  }

  async sendBreakGlassClosedEmail(
    to: string | string[],
    data: {
      firstName: string;
      incidentType: string;
      resolution: string;
      closedTime: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: 'Emergency Resolved - Break-Glass Closed',
      template: 'breakglass-closed',
      data,
      priority: 'NORMAL',
    });
  }

  async sendBugStatusChangedEmail(
    to: string,
    data: {
      firstName: string;
      bugId: string;
      title: string;
      oldStatus: string;
      newStatus: string;
      changeTime: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Bug Report Status Updated: ${data.bugId}`,
      template: 'bug-status-changed',
      data,
      priority: 'NORMAL',
    });
  }

  async sendAdCampaignDecisionEmail(
    to: string,
    data: {
      firstName: string;
      campaignName: string;
      status: 'APPROVED' | 'REJECTED';
      feedback?: string;
      decisionDate: string;
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Ad Campaign ${data.status}: ${data.campaignName}`,
      template: 'ad-campaign-decision',
      data,
      priority: data.status === 'APPROVED' ? 'HIGH' : 'NORMAL',
    });
  }

  async sendSafetyWarningEmail(
    to: string | string[],
    data: {
      firstName: string;
      warningType: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      description: string;
      actionRequired: string;
      timestamp: string;
    }
  ): Promise<EmailResult> {
    const priorityMap = {
      LOW: 'NORMAL',
      MEDIUM: 'NORMAL',
      HIGH: 'HIGH',
      CRITICAL: 'HIGH',
    };

    return this.send({
      to,
      subject: `Safety Warning: ${data.warningType}`,
      template: 'safety-warning',
      data,
      priority: priorityMap[data.severity] as 'HIGH' | 'NORMAL',
    });
  }

  async sendTrekStartReminderEmail(
    to: string,
    data: {
      firstName: string;
      trekName: string;
      startDate: string;
      departureTime: string;
      meetingLocation: string;
      guidePhone: string;
      checklist: string[];
    }
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: `Trek Starting Tomorrow: ${data.trekName}`,
      template: 'trek-start-reminder',
      data,
      priority: 'HIGH',
    });
  }

  // ===== TEMPLATE HTML RENDERER =====

  private getTemplateHTML(template: string, data: EmailTemplateData): string {
    const templates: { [key: string]: string } = {
      'inquiry-received': `
        <h1>Hi ${data.firstName},</h1>
        <p>Thank you for your interest in <strong>${data.trekName}</strong>!</p>
        <p>We've received your inquiry and our team is reviewing your details.</p>
        <p><strong>Inquiry ID:</strong> ${data.inquiryId}</p>
        <a href="${data.trackingUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Track Your Inquiry</a>
        <p>You'll hear back from us within 24 hours with personalized trek details and pricing.</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
        <p><small>Sent via ${this.brandName} Trek Platform</small></p>
      `,
      'booking-confirmed': `
        <h1>Hi ${data.firstName},</h1>
        <p>Your booking for <strong>${data.trekName}</strong> is confirmed!</p>
        <p><strong>Booking ID:</strong> ${data.bookingId}</p>
        <p><strong>Trek:</strong> ${data.trekName}</p>
        <p><strong>Start Date:</strong> ${data.startDate}</p>
        <p><strong>Duration:</strong> ${data.duration} days</p>
        <p><strong>Guide:</strong> ${data.guide}</p>
        <p><strong>Total Price:</strong> ${data.totalPrice}</p>
        <a href="${data.itineraryPdfUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Download Itinerary</a>
        <a href="${data.dashboardUrl}" style="background: #e5e7eb; color: #1f2937; padding: 10px 20px; border-radius: 4px; text-decoration: none; margin-left: 10px;">View Booking Details</a>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
        <p><small>Sent via ${this.brandName} Trek Platform</small></p>
      `,
      'payment-link': `
        <h1>Hi ${data.firstName},</h1>
        <p>It's time to secure your spot for <strong>${data.trekName}</strong>!</p>
        <p><strong>Amount Due:</strong> ${data.amount}</p>
        <p><strong>Booking ID:</strong> ${data.bookingId}</p>
        <p><strong>Payment Due:</strong> ${data.dueDate}</p>
        <a href="${data.paymentUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Complete Payment Now</a>
        <p>Your payment is secure and processed through Stripe.</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'trek-reminder': `
        <h1>Get Ready, ${data.firstName}!</h1>
        <p>Your <strong>${data.trekName}</strong> adventure starts in 48 hours!</p>
        <p><strong>Date:</strong> ${data.startDate}</p>
        <p><strong>Time:</strong> ${data.departureTime}</p>
        <p><strong>Meeting Point:</strong> ${data.meetingLocation}</p>
        <p><strong>Guide Contact:</strong> ${data.guidePhone}</p>
        <h3>Pre-Trek Checklist:</h3>
        <ul>
          ${data.checklist.map((item: string) => `<li>${item}</li>`).join('')}
        </ul>
        <p>Looking forward to seeing you on the trail!</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'guide-contact': `
        <h1>Meet Your Guide!</h1>
        <p>We're thrilled to introduce you to <strong>${data.guideName}</strong>, who will be guiding you on the <strong>${data.trekName}</strong> trek.</p>
        <p><strong>Direct Contact:</strong></p>
        <p>Phone: ${data.guidePhone}</p>
        <p>Email: ${data.guideEmail}</p>
        <p>Feel free to reach out to introduce yourself!</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'review-invitation': `
        <h1>How Was Your Trek?</h1>
        <p>Congratulations on completing <strong>${data.trekName}</strong> on ${data.completionDate}!</p>
        <p>Your feedback helps us improve our treks and helps other adventurers find the perfect expedition.</p>
        <a href="${data.reviewUrl}" style="background: #f59e0b; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Share Your Review</a>
        <p><strong>Special Offer:</strong> Leave a review and get <strong>10% off</strong> your next trek with code TREKAGAIN10!</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'sos-notification': `
        <h1 style="color: #dc2626;">SOS EMERGENCY ALERT</h1>
        <p><strong>Alert Type:</strong> ${data.sosType}</p>
        <p><strong>Trek:</strong> ${data.trekName}</p>
        <p><strong>Guide:</strong> ${data.guideName}</p>
        <p><strong>Location:</strong> ${data.location}</p>
        <p><strong>Reported:</strong> ${data.timestamp}</p>
        <p style="background: #fee2e2; padding: 10px; border-left: 4px solid #dc2626;">
          <strong>IMPORTANT:</strong> Our emergency response team has been notified and is monitoring the situation.
        </p>
        <hr>
        <p><small>This email contains sensitive information. Do not share publicly.</small></p>
      `,
      'welcome': `
        <h1>Welcome to Funtush, ${data.firstName}!</h1>
        <p>We're thrilled to have you join our community of adventure seekers and experienced guides.</p>
        <p>To get started, please verify your email address by clicking the button below:</p>
        <a href="${data.verificationUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Verify Email Address</a>
        <p>If you didn't create this account, please ignore this email.</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'kyc-submitted': `
        <h1>KYC Verification Submitted</h1>
        <p>Hi ${data.firstName},</p>
        <p>We've received your Know Your Customer (KYC) verification documents.</p>
        <p><strong>Submission Date:</strong> ${data.submissionDate}</p>
        <p><strong>Reference ID:</strong> ${data.referenceId}</p>
        <p>Our team will review your documents and get back to you within 24-48 hours.</p>
        <p>You can track the status of your KYC verification in your account dashboard.</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'kyc-approved': `
        <h1>KYC Verification Approved</h1>
        <p>Hi ${data.firstName},</p>
        <p><strong style="color: #059669;">Congratulations! Your KYC verification has been approved.</strong></p>
        <p><strong>Approval Date:</strong> ${data.approvalDate}</p>
        <p>You now have full access to all Funtush features and can:</p>
        <ul>
          <li>Create and publish trek listings</li>
          <li>Accept bookings from trekkers</li>
          <li>Process payments</li>
          <li>Access analytics and reporting</li>
        </ul>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'kyc-rejected': `
        <h1>KYC Verification - Action Required</h1>
        <p>Hi ${data.firstName},</p>
        <p>Unfortunately, your KYC verification could not be approved at this time.</p>
        <p><strong>Reason:</strong> ${data.reason}</p>
        <p>Please review the reason above and resubmit your documents. Make sure:</p>
        <ul>
          <li>Documents are clear and readable</li>
          <li>All required fields are filled</li>
          <li>Information matches your account details</li>
        </ul>
        <a href="${data.resubmitUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Resubmit Documents</a>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'payment-confirmation': `
        <h1>Payment Confirmed</h1>
        <p>Hi ${data.firstName},</p>
        <p><strong style="color: #059669;">Your payment has been successfully received.</strong></p>
        <p><strong>Amount:</strong> ${data.amount}</p>
        <p><strong>Date:</strong> ${data.date}</p>
        <p><strong>Transaction ID:</strong> ${data.transactionId}</p>
        <p><strong>Description:</strong> ${data.description}</p>
        <a href="${data.invoiceUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Download Invoice</a>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'renewal-reminder': `
        <h1>Subscription Renewal Reminder</h1>
        <p>Hi ${data.firstName},</p>
        <p>Your ${data.subscriptionType} subscription expires in ${data.daysRemaining} days.</p>
        <p><strong>Subscription Type:</strong> ${data.subscriptionType}</p>
        <p><strong>Expires On:</strong> ${data.expiryDate}</p>
        <p>To avoid any service interruption, please renew your subscription now.</p>
        <a href="${data.renewalUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Renew Subscription</a>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'payment-failed': `
        <h1>Payment Failed - Action Required</h1>
        <p>Hi ${data.firstName},</p>
        <p><strong style="color: #dc2626;">We couldn't process your payment on ${data.attemptDate}.</strong></p>
        <p><strong>Amount:</strong> ${data.amount}</p>
        <p><strong>Reason:</strong> ${data.reason}</p>
        <p>Please update your payment method and try again to avoid service interruption.</p>
        <a href="${data.retryUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Retry Payment</a>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'breakglass-initiated': `
        <h1 style="color: #dc2626;">EMERGENCY BREAK-GLASS ACTIVATED</h1>
        <p>An emergency break-glass protocol has been activated.</p>
        <p><strong>Incident Type:</strong> ${data.incidentType}</p>
        <p><strong>Time:</strong> ${data.timestamp}</p>
        <p><strong>Location:</strong> ${data.location}</p>
        <a href="${data.statusUrl}" style="background: #dc2626; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">View Status</a>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'breakglass-closed': `
        <h1 style="color: #059669;">Emergency Resolved</h1>
        <p>Hi ${data.firstName},</p>
        <p>The emergency break-glass incident has been resolved.</p>
        <p><strong>Incident Type:</strong> ${data.incidentType}</p>
        <p><strong>Closed At:</strong> ${data.closedTime}</p>
        <p><strong>Resolution:</strong> ${data.resolution}</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'bug-status-changed': `
        <h1>Bug Report Status Updated</h1>
        <p>Hi ${data.firstName},</p>
        <p>A bug you reported has been updated.</p>
        <p><strong>Bug ID:</strong> ${data.bugId}</p>
        <p><strong>Title:</strong> ${data.title}</p>
        <p><strong>Previous Status:</strong> ${data.oldStatus}</p>
        <p><strong>New Status:</strong> ${data.newStatus}</p>
        <p><strong>Updated At:</strong> ${data.changeTime}</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'ad-campaign-decision': `
        <h1>Ad Campaign ${data.status === 'APPROVED' ? 'Approved' : 'Rejected'}</h1>
        <p>Hi ${data.firstName},</p>
        <p>Your ad campaign has been ${data.status === 'APPROVED' ? 'approved and is now live' : 'rejected'}.</p>
        <p><strong>Campaign Name:</strong> ${data.campaignName}</p>
        <p><strong>Status:</strong> <span style="color: ${data.status === 'APPROVED' ? '#059669' : '#dc2626'}">${data.status}</span></p>
        ${data.feedback ? `<p><strong>Feedback:</strong> ${data.feedback}</p>` : ''}
        <p><strong>Decision Date:</strong> ${data.decisionDate}</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'safety-warning': `
        <h1 style="color: #ef4444;">Safety Warning: ${data.warningType}</h1>
        <p>Hi ${data.firstName},</p>
        <p>We've detected a safety concern that requires your attention.</p>
        <p><strong>Severity:</strong> ${data.severity}</p>
        <p><strong>Detected At:</strong> ${data.timestamp}</p>
        <p><strong>Description:</strong> ${data.description}</p>
        <p><strong>Action Required:</strong> ${data.actionRequired}</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'trek-start-reminder': `
        <h1>Trek Starting Tomorrow: ${data.trekName}</h1>
        <p>Hi ${data.firstName},</p>
        <p>Your <strong>${data.trekName}</strong> adventure starts tomorrow!</p>
        <p><strong>Date:</strong> ${data.startDate}</p>
        <p><strong>Time:</strong> ${data.departureTime}</p>
        <p><strong>Meeting Point:</strong> ${data.meetingLocation}</p>
        <p><strong>Guide Contact:</strong> ${data.guidePhone}</p>
        <h3>Pre-Trek Checklist:</h3>
        <ul>
          ${data.checklist.map((item: string) => `<li>${item}</li>`).join('')}
        </ul>
        <p>Looking forward to seeing you on the trail!</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
    };

    return templates[template] || `<p>Unknown template: ${template}</p>`;
  }
}

export const emailService = new EmailService();