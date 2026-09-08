import { describe, it, expect } from 'vitest';
import { emailService } from '../src/services/emailService';

describe('EmailService', () => {
  it('should send inquiry received email', async () => {
    const result = await emailService.sendInquiryReceived(
      'test@example.com',
      {
        firstName: 'John',
        trekName: 'Everest Base Camp',
        inquiryId: 'INQ-12345',
        trackingUrl: 'https://funtush.com/track/INQ-12345',
      }
    );

    console.log('Email Result:', result);
  });

  it('should send booking confirmed email', async () => {
    const result = await emailService.sendBookingConfirmed(
      'test@example.com',
      {
        firstName: 'John',
        bookingId: 'BK-67890',
        trekName: 'Everest Base Camp',
        startDate: '2024-05-15',
        duration: '14',
        guide: 'Sherpa Tenzing',
        itineraryPdfUrl: 'https://funtush.com/pdfs/itinerary.pdf',
        dashboardUrl: 'https://funtush.com/bookings/BK-67890',
        totalPrice: '$2,500',
      }
    );

    console.log('Booking Email Result:', result);
  });

  it('should send trek reminder email', async () => {
    const result = await emailService.sendTrekReminder(
      'test@example.com',
      {
        firstName: 'John',
        trekName: 'Everest Base Camp',
        startDate: 'May 15, 2024',
        departureTime: '6:00 AM',
        meetingLocation: 'Hotel Sheraton, Lobby',
        guidePhone: '+977 9841234567',
        checklist: [
          'Passport and visa',
          'Travel insurance',
          'Hiking boots',
        ],
      }
    );

    console.log('Trek Reminder Email Result:', result);
  });
});