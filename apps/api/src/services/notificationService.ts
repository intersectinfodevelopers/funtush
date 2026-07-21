import { smsService } from './smsService';

interface NotificationTarget {
  userId: string;
  email: string;
  phoneNumber: string;
  pushToken?: string;
}

interface NotificationPayload {
  title: string;
  body: string;
  priority: 'NORMAL' | 'CRITICAL';
  type: 'BOOKING' | 'TREK_UPDATE' | 'PAYMENT' | 'REMINDER' | 'SOS';
  data?: Record<string, string>;
}

class NotificationService {
  private PUSH_TIMEOUT_MS = parseInt(
    process.env.PUSH_TIMEOUT_MS || '5000',
    10
  );

  async send(
    target: NotificationTarget,
    payload: NotificationPayload
  ): Promise<{
    push?: { success: boolean; messageId?: string };
    sms?: { success: boolean; messageId?: string };
    fallbackReason?: string;
  }> {
    const result: any = {};

    if (!target.pushToken || payload.priority === 'CRITICAL') {
      console.log(
        `[NOTIFICATION] Skipping push, using SMS for ${target.phoneNumber}`
      );
      result.fallbackReason = 'CRITICAL_PRIORITY';
      result.sms = await this.sendSMSNotification(
        target.phoneNumber,
        payload
      );
      return result;
    }

    try {
      result.push = await Promise.race([
        this.sendPushNotification(target.pushToken, payload),
        this.createTimeoutPromise(this.PUSH_TIMEOUT_MS),
      ]);

      if (result.push.success) {
        return result;
      }
    } catch (error) {
      console.warn(
        `[NOTIFICATION] Push failed for ${target.userId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    console.log(`[NOTIFICATION] Falling back to SMS for ${target.phoneNumber}`);
    result.fallbackReason = 'PUSH_FAILED';
    result.sms = await this.sendSMSNotification(
      target.phoneNumber,
      payload
    );

    return result;
  }

  private async sendSMSNotification(
    phoneNumber: string,
    payload: NotificationPayload
  ): Promise<{ success: boolean; messageId?: string }> {
    let message = `${payload.title}\n${payload.body}`;

    if (payload.type === 'TREK_UPDATE' && payload.data?.trekName) {
      message += `\nTrek: ${payload.data.trekName}`;
    }

    if (payload.type === 'REMINDER' && payload.data?.time) {
      message += `\nTime: ${payload.data.time}`;
    }

    const result = await smsService.sendSMS(phoneNumber, message, {
      priority: payload.priority,
    });

    return {
      success: result.success,
      messageId: result.messageId,
    };
  }

  private async sendPushNotification(
    token: string,
    payload: NotificationPayload
  ): Promise<{ success: boolean; messageId?: string }> {
    return { success: true, messageId: 'push-123' };
  }

  private createTimeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Push timeout after ${ms}ms`)),
        ms
      )
    );
  }
}

export const notificationService = new NotificationService();