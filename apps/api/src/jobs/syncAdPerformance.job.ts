import { CronJob } from 'cron';
import { prisma } from '@funtush/database';
import { syncAndGetCampaignPerformance } from '../services/adPerformanceService';
import { acquireJobLock } from "./jobLock";

export function startAdPerformanceSyncJob() {
  const job = new CronJob('0 2 * * *', async () => {
    if (!(await acquireJobLock("ad-performance-sync", 600))) return; // another process owns this tick

    console.log('[AD_PERF_SYNC] Starting daily performance sync...');

    try {
      // Get all ACTIVE campaigns
      const activeCampaigns = await prisma.adCampaign.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, agencyId: true, metaCampaignId: true, googleCampaignId: true },
      });

      if (activeCampaigns.length === 0) {
        console.log('[AD_PERF_SYNC] No active campaigns to sync');
        return;
      }

      // Sync each campaign
      for (const campaign of activeCampaigns) {
        try {
          await syncAndGetCampaignPerformance(campaign.id, campaign.agencyId);
          console.log(`[AD_PERF_SYNC] Synced campaign ${campaign.id}`);
        } catch (err) {
          console.error(`[AD_PERF_SYNC] Failed for campaign ${campaign.id}:`, err);
        }
      }

      console.log('[AD_PERF_SYNC] Daily sync complete');
    } catch (err) {
      console.error('[AD_PERF_SYNC] Job failed:', err);
    }
  });

  job.start();
  console.log('[AD_PERF_SYNC] Job scheduled for daily 2 AM UTC');
}