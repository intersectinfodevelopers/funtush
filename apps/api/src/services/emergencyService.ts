import { smsService } from './smsService';

interface SOSEvent {
  trekId: string;
  guiderId: string;
  trekkerIds: string[];
  sosType: 'MEDICAL' | 'WEATHER' | 'LOST' | 'MANUAL';
  location: string;
  notes?: string;
}

class EmergencyService {
  async triggerSOS(event: SOSEvent): Promise<void> {
    console.log(`[SOS TRIGGERED] ${event.sosType} at ${event.location}`);

    const guidePhone = '+919876543210';
    const trekkerPhones = ['+919876543211', '+919876543212'];

    if (guidePhone) {
      await smsService.sendSOSConfirmation(guidePhone, {
        location: event.location,
        guideName: 'Guide Name',
        emergencyNumber: process.env.EMERGENCY_HOTLINE || '+911',
        sosType: event.sosType,
      });
    }

    for (const phone of trekkerPhones) {
      if (phone) {
        await smsService.sendSMS(
          phone,
          `🆘 GUIDE SOS: ${event.sosType} at ${event.location}. Follow guide instructions. Emergency: +911`,
          { priority: 'CRITICAL' }
        );
      }
    }

    console.log('[SOS] Notifications sent to all participants');
  }

  async cancelSOS(sosId: string, reason: string): Promise<void> {
    const guidePhone = '+919876543210';

    if (guidePhone) {
      await smsService.sendSMS(
        guidePhone,
        `✓ SOS CANCELLED\nReason: ${reason}\nAll clear.`,
        { priority: 'CRITICAL' }
      );
    }

    console.log(`[SOS CANCELLED] ${sosId}`);
  }
}

export const emergencyService = new EmergencyService();