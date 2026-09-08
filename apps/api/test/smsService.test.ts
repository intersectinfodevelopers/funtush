import { describe, it, expect } from 'vitest';
import { smsService } from '../src/services/smsService';

describe('SMSService', () => {
  it('should validate phone number format', async () => {
    const result = await smsService.sendSMS(
      '+919876543210',
      'Test SMS from Funtush'
    );

    console.log('SMS Result:', result);
  });

  it('should send CRITICAL priority SMS', async () => {
    const result = await smsService.sendSMS(
      '+919876543210',
      'Emergency notification',
      { priority: 'CRITICAL' }
    );

    console.log('Critical SMS Result:', result);
  });
});