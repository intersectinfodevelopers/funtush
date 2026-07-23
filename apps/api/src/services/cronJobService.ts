import cron from 'node-cron';
import { db } from '@funtush/database';
import { emailService } from './emailService';

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  isActive: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

class CronJobService {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private isInitialized = false;

  /**
   * Initialize all scheduled cron jobs
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('[CRON] Initializing scheduled jobs...');

      // 30-day renewal reminder (runs daily at 9 AM)
      this.scheduleRenewalReminder30Days();

      // 7-day renewal reminder (runs daily at 10 AM)
      this.scheduleRenewalReminder7Days();

      // Trek start reminder (runs daily at 8 AM)
      this.scheduleTrekStartReminder();

      this.isInitialized = true;
      console.log('[CRON] All scheduled jobs initialized successfully');
    } catch (error) {
      console.error('[CRON] Failed to initialize jobs:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 30-day subscription renewal reminder
   * Runs daily at 9:00 AM
   */
  private scheduleRenewalReminder30Days(): void {
    const task = cron.schedule('0 9 * * *', async () => {
      try {
        console.log('[CRON] Running 30-day renewal reminder job...');

        // Calculate target date: 30 days from now
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 30);
        targetDate.setHours(0, 0, 0, 0);

        // Get all subscriptions expiring in ~30 days
        const expiringSubscriptions = await db.subscription.findMany({
          where: {
            expiryDate: {
              gte: new Date(targetDate.getTime() - 24 * 60 * 60 * 1000),
              lte: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
            },
            status: 'ACTIVE',
            reminderSent30Days: false,
          },
          include: { user: true },
        });

        console.log(`[CRON] Found ${expiringSubscriptions.length} subscriptions expiring in 30 days`);

        // Send reminder emails
        for (const subscription of expiringSubscriptions) {
          try {
            const result = await emailService.sendRenewalReminderEmail(
              subscription.user.email,
              {
                firstName: subscription.user.firstName || 'User',
                subscriptionType: subscription.type,
                expiryDate: subscription.expiryDate.toLocaleDateString(),
                daysRemaining: 30,
                renewalUrl: `${process.env.APP_URL}/account/subscription/renew/${subscription.id}`,
              }
            );

            if (result.success) {
              // Mark reminder as sent
              await db.subscription.update({
                where: { id: subscription.id },
                data: { reminderSent30Days: true },
              });
            }
          } catch (error) {
            console.error(
              `[CRON] Failed to send 30-day reminder for subscription ${subscription.id}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }

        console.log('[CRON] 30-day renewal reminder job completed');
      } catch (error) {
        console.error('[CRON] Error in 30-day renewal reminder job:', error instanceof Error ? error.message : String(error));
      }
    });

    this.jobs.set('renewal-30day', task);
  }

  /**
   * 7-day subscription renewal reminder
   * Runs daily at 10:00 AM
   */
  private scheduleRenewalReminder7Days(): void {
    const task = cron.schedule('0 10 * * *', async () => {
      try {
        console.log('[CRON] Running 7-day renewal reminder job...');

        // Calculate target date: 7 days from now
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 7);
        targetDate.setHours(0, 0, 0, 0);

        // Get all subscriptions expiring in ~7 days
        const expiringSubscriptions = await db.subscription.findMany({
          where: {
            expiryDate: {
              gte: new Date(targetDate.getTime() - 24 * 60 * 60 * 1000),
              lte: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
            },
            status: 'ACTIVE',
            reminderSent7Days: false,
          },
          include: { user: true },
        });

        console.log(`[CRON] Found ${expiringSubscriptions.length} subscriptions expiring in 7 days`);

        // Send reminder emails
        for (const subscription of expiringSubscriptions) {
          try {
            const result = await emailService.sendRenewalReminderEmail(
              subscription.user.email,
              {
                firstName: subscription.user.firstName || 'User',
                subscriptionType: subscription.type,
                expiryDate: subscription.expiryDate.toLocaleDateString(),
                daysRemaining: 7,
                renewalUrl: `${process.env.APP_URL}/account/subscription/renew/${subscription.id}`,
              }
            );

            if (result.success) {
              // Mark reminder as sent
              await db.subscription.update({
                where: { id: subscription.id },
                data: { reminderSent7Days: true },
              });
            }
          } catch (error) {
            console.error(
              `[CRON] Failed to send 7-day reminder for subscription ${subscription.id}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }

        console.log('[CRON] 7-day renewal reminder job completed');
      } catch (error) {
        console.error('[CRON] Error in 7-day renewal reminder job:', error instanceof Error ? error.message : String(error));
      }
    });

    this.jobs.set('renewal-7day', task);
  }

  /**
   * Trek start reminder
   * Runs daily at 8:00 AM
   * Sends reminder to trekkers 48 hours before trek start
   */
  private scheduleTrekStartReminder(): void {
    const task = cron.schedule('0 8 * * *', async () => {
      try {
        console.log('[CRON] Running trek start reminder job...');

        // Calculate target date: 48 hours from now
        const targetDate = new Date();
        targetDate.setHours(targetDate.getHours() + 48);

        // Get all treks starting in ~48 hours
        const upcomingTreks = await db.trek.findMany({
          where: {
            startDate: {
              gte: new Date(targetDate.getTime() - 2 * 60 * 60 * 1000),
              lte: new Date(targetDate.getTime() + 2 * 60 * 60 * 1000),
            },
            status: 'CONFIRMED',
            reminderSent48Hours: false,
          },
          include: {
            bookings: {
              include: { user: true },
            },
            guide: true,
          },
        });

        console.log(`[CRON] Found ${upcomingTreks.length} treks starting in 48 hours`);

        // Send reminder emails to all trekkers
        for (const trek of upcomingTreks) {
          try {
            for (const booking of trek.bookings) {
              const result = await emailService.sendTrekStartReminderEmail(
                booking.user.email,
                {
                  firstName: booking.user.firstName || 'Trekker',
                  trekName: trek.name,
                  startDate: trek.startDate.toLocaleDateString(),
                  departureTime: trek.startTime || '8:00 AM',
                  meetingLocation: trek.meetingLocation,
                  guidePhone: trek.guide.phone,
                  checklist: [
                    'Pack all required gear',
                    'Charge all devices',
                    'Check weather forecast',
                    'Inform emergency contact',
                    'Arrive 15 minutes early',
                  ],
                }
              );

              if (!result.success) {
                console.warn(
                  `[CRON] Failed to send 48-hour reminder to ${booking.user.email}`
                );
              }
            }

            // Mark reminder as sent
            await db.trek.update({
              where: { id: trek.id },
              data: { reminderSent48Hours: true },
            });
          } catch (error) {
            console.error(
              `[CRON] Failed to send trek start reminder for trek ${trek.id}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }

        console.log('[CRON] Trek start reminder job completed');
      } catch (error) {
        console.error('[CRON] Error in trek start reminder job:', error instanceof Error ? error.message : String(error));
      }
    });

    this.jobs.set('trek-start-48h', task);
  }

  /**
   * Stop all scheduled jobs
   */
  async stopAll(): Promise<void> {
    console.log('[CRON] Stopping all scheduled jobs...');

    for (const [name, task] of this.jobs.entries()) {
      task.stop();
      console.log(`[CRON] Stopped job: ${name}`);
    }

    this.jobs.clear();
    this.isInitialized = false;
  }

  /**
   * Get status of all jobs
   */
  getStatus(): CronJob[] {
    return Array.from(this.jobs.entries()).map(([name]) => ({
      id: name,
      name,
      schedule: this.getScheduleDescription(name),
      isActive: true,
      lastRun: undefined,
      nextRun: undefined,
    }));
  }

  /**
   * Get human-readable schedule description
   */
  private getScheduleDescription(jobName: string): string {
    const descriptions: { [key: string]: string } = {
      'renewal-30day': '0 9 * * * (Daily at 9:00 AM)',
      'renewal-7day': '0 10 * * * (Daily at 10:00 AM)',
      'trek-start-48h': '0 8 * * * (Daily at 8:00 AM)',
    };

    return descriptions[jobName] || 'Unknown schedule';
  }
}

export const cronJobService = new CronJobService();