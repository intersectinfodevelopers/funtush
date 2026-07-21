import { Resend } from 'resend';

interface EmailTemplateData {
  [key: string]: string | number | boolean | any;
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

    // Initialize Resend with graceful error handling
    const apiKey = process.env.RESEND_API_KEY;
    
    if (apiKey) {
      try {
        this.resend = new Resend(apiKey);
        console.log('[EMAIL] Resend client initialized successfully');
      } catch (error) {
        console.warn('[EMAIL] Failed to initialize Resend client:', error instanceof Error ? error.message : String(error));
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

      // If no client (test mode or not configured), return mock success
      if (!this.resend || this.isTestMode) {
        const toAddresses = Array.isArray(options.to) ? options.to.join(', ') : options.to;
        console.log(`[EMAIL MOCK] ${options.template} → ${toAddresses}`);
        return {
          success: true,
          messageId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
        };
      }

      // Real email sending
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[EMAIL ERROR] ${options.template}:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

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
      subject: `🆘 SOS Alert: ${data.trekName}`,
      template: 'sos-notification',
      data,
      priority: 'HIGH',
      replyTo: process.env.EMERGENCY_EMAIL,
    });
  }

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
        <p>🎉 Your booking for <strong>${data.trekName}</strong> is confirmed!</p>
        <p><strong>Booking ID:</strong> ${data.bookingId}</p>
        <p><strong>Trek:</strong> ${data.trekName}</p>
        <p><strong>Start Date:</strong> ${data.startDate}</p>
        <p><strong>Duration:</strong> ${data.duration} days</p>
        <p><strong>Guide:</strong> ${data.guide}</p>
        <p><strong>Total Price:</strong> ${data.totalPrice}</p>
        <a href="${data.itineraryPdfUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">📄 Download Itinerary</a>
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
        <a href="${data.paymentUrl}" style="background: #059669; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">💳 Complete Payment Now</a>
        <p>🔒 Your payment is secure and processed through Stripe.</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'trek-reminder': `
        <h1>🏔️ Get Ready, ${data.firstName}!</h1>
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
        <p>📱 ${data.guidePhone}</p>
        <p>📧 ${data.guideEmail}</p>
        <p>Feel free to reach out to introduce yourself!</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'review-invitation': `
        <h1>How Was Your Trek?</h1>
        <p>Congratulations on completing <strong>${data.trekName}</strong> on ${data.completionDate}!</p>
        <p>Your feedback helps us improve our treks and helps other adventurers find the perfect expedition.</p>
        <a href="${data.reviewUrl}" style="background: #f59e0b; color: white; padding: 10px 20px; border-radius: 4px; text-decoration: none;">⭐ Share Your Review</a>
        <p><strong>Special Offer:</strong> Leave a review and get <strong>10% off</strong> your next trek with code TREKAGAIN10!</p>
        <hr>
        <p><small>© 2024 ${this.brandName}. All rights reserved.</small></p>
      `,
      'sos-notification': `
        <h1 style="color: #dc2626;">🆘 EMERGENCY ALERT</h1>
        <p><strong>Alert Type:</strong> ${data.sosType}</p>
        <p><strong>Trek:</strong> ${data.trekName}</p>
        <p><strong>Guide:</strong> ${data.guideName}</p>
        <p><strong>Location:</strong> ${data.location}</p>
        <p><strong>Reported:</strong> ${data.timestamp}</p>
        <p style="background: #fee2e2; padding: 10px; border-left: 4px solid #dc2626;">
          <strong>⚠️ IMPORTANT:</strong> Our emergency response team has been notified and is monitoring the situation.
        </p>
        <hr>
        <p><small>This email contains sensitive information. Do not share publicly.</small></p>
      `,
    };

    return (
      templates[template] ||
      `<p>Unknown template: ${template}</p>`
    );
  }
}

// Create singleton instance - no errors thrown
export const emailService = new EmailService();