import twilio from 'twilio';

interface SMSOptions {
  priority?: 'NORMAL' | 'CRITICAL';
  retryCount?: number;
  maxRetries?: number;
}

interface SMSResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
  timestamp: Date;
}

class SMSService {
  private client: twilio.Twilio | null;
  private fromNumber: string;
  private retryAttempts = new Map<string, number>();
  private isTestMode: boolean;

  constructor() {
    this.isTestMode = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
    
    // Set from number with fallback
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '+1234567890';

    // Initialize Twilio client with graceful error handling
    if (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN
    ) {
      try {
        this.client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        console.log('[SMS] Twilio client initialized successfully');
      } catch (error) {
        console.warn('[SMS] Failed to initialize Twilio client:', error instanceof Error ? error.message : String(error));
        this.client = null;
      }
    } else {
      console.warn('[SMS] Twilio credentials not configured. Running in mock mode.');
      this.client = null;
    }
  }

  async sendSMS(
    phoneNumber: string,
    message: string,
    options: SMSOptions = {}
  ): Promise<SMSResult> {
    const {
      priority = 'NORMAL',
      maxRetries = priority === 'CRITICAL' ? 3 : 1,
    } = options;

    let retryCount = this.retryAttempts.get(phoneNumber) || 0;

    try {
      // Validate phone number
      if (!this.validatePhoneNumber(phoneNumber)) {
        return {
          success: false,
          error: `Invalid phone number: ${phoneNumber}`,
          timestamp: new Date(),
        };
      }

      const truncatedMessage = this.truncateMessage(message);

      // If no client (test mode or not configured), return mock success
      if (!this.client || this.isTestMode) {
        console.log(`[SMS MOCK] ${phoneNumber}: ${truncatedMessage.substring(0, 50)}...`);
        return {
          success: true,
          messageId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          status: 'queued',
          timestamp: new Date(),
        };
      }

      // Real SMS sending
      const result = await this.client.messages.create({
        body: truncatedMessage,
        from: this.fromNumber,
        to: phoneNumber,
      });

      this.retryAttempts.delete(phoneNumber);

      console.log(`[SMS SUCCESS] ${result.sid} → ${phoneNumber}`);

      return {
        success: true,
        messageId: result.sid,
        status: result.status,
        timestamp: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Retry logic for CRITICAL messages
      if (priority === 'CRITICAL' && retryCount < maxRetries) {
        this.retryAttempts.set(phoneNumber, retryCount + 1);
        console.warn(
          `[SMS RETRY] Attempt ${retryCount + 1}/${maxRetries} for ${phoneNumber}`
        );

        await this.delay(Math.pow(2, retryCount) * 1000);
        return this.sendSMS(phoneNumber, message, {
          ...options,
          retryCount: retryCount + 1,
        });
      }

      // Failed after retries
      this.retryAttempts.delete(phoneNumber);
      console.error(`[SMS FAILED] ${phoneNumber} - ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  async sendSOSConfirmation(
    phoneNumber: string,
    sosDetails: {
      location: string;
      guideName: string;
      emergencyNumber: string;
      sosType: 'MEDICAL' | 'WEATHER' | 'LOST' | 'MANUAL';
    }
  ): Promise<SMSResult> {
    const message = `🆘 SOS ALERT - Funtush
Location: ${sosDetails.location}
Guide: ${sosDetails.guideName}
Type: ${sosDetails.sosType}
Emergency: ${sosDetails.emergencyNumber}

Reply CANCEL to dismiss.`;

    return this.sendSMS(phoneNumber, message, {
      priority: 'CRITICAL',
      maxRetries: 3,
    });
  }

  private validatePhoneNumber(phoneNumber: string): boolean {
    // E.164 format: +1234567890
    const e164Regex = /^\+?[1-9]\d{1,14}$/;
    return e164Regex.test(phoneNumber.replace(/\s/g, ''));
  }

  private truncateMessage(message: string): string {
    const SINGLE_SMS_LIMIT = 160;
    const UNICODE_SMS_LIMIT = 70;

    if (message.length <= SINGLE_SMS_LIMIT) {
      return message;
    }

    const isUnicode = /[^\x00-\x7F]/.test(message);
    const limit = isUnicode ? UNICODE_SMS_LIMIT : SINGLE_SMS_LIMIT;

    return message.substring(0, limit - 3) + '...';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Create singleton instance - no errors thrown
export const smsService = new SMSService();