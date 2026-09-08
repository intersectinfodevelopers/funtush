import { db } from '@funtush/database';
import { fetchCampaignMetrics } from '../lib/adPlatforms';

function todayDateOnly(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function dateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function syncAndGetCampaignPerformance(
  campaignId: string,
  agencyId: string
) {
  const campaign = await db.adCampaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign || campaign.agencyId !== agencyId) {
    throw new Error('Campaign not found or unauthorized');
  }

  if (campaign.metaCampaignId || campaign.googleCampaignId) {
    const today = todayDateOnly();
    const todayStr = dateString(today);

    let metrics = {
      meta: {
        impressions: 0,
        clicks: 0,
        spend: 0,
      },
      google: {
        impressions: 0,
        clicks: 0,
        spend: 0,
      },
    };

    try {
      metrics = await fetchCampaignMetrics(
        {
          metaCampaignId: campaign.metaCampaignId ?? '',
          googleCampaignId: campaign.googleCampaignId ?? '',
          googleSearchCampaignId: campaign.googleSearchCampaignId ?? ''
        },
        todayStr
      );
    } catch (err) {
      console.error('Performance sync failed:', err);
    }

    if (campaign.metaCampaignId) {
      await db.adPerformanceDaily.upsert({
        where: {
          campaignId_platform_date: {
            campaignId,
            platform: 'META',
            date: today,
          },
        },
        update: {
          impressions: metrics.meta.impressions,
          clicks: metrics.meta.clicks,
          spend: metrics.meta.spend,
        },
        create: {
          campaignId,
          platform: 'META',
          date: today,
          impressions: metrics.meta.impressions,
          clicks: metrics.meta.clicks,
          spend: metrics.meta.spend,
        },
      });
    }

    if (campaign.googleCampaignId) {
      await db.adPerformanceDaily.upsert({
        where: {
          campaignId_platform_date: {
            campaignId,
            platform: 'GOOGLE',
            date: today,
          },
        },
        update: {
          impressions: metrics.google.impressions,
          clicks: metrics.google.clicks,
          spend: metrics.google.spend,
        },
        create: {
          campaignId,
          platform: 'GOOGLE',
          date: today,
          impressions: metrics.google.impressions,
          clicks: metrics.google.clicks,
          spend: metrics.google.spend,
        },
      });
    }
  }

  const dailyRows = await db.adPerformanceDaily.findMany({
    where: { campaignId },
    orderBy: { date: 'asc' },
  });

  const totals = dailyRows.reduce(
    (acc, row) => ({
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      spend: acc.spend + Number(row.spend),
    }),
    {
      impressions: 0,
      clicks: 0,
      spend: 0,
    }
  );

  const byPlatform = {
    META: dailyRows
      .filter((row) => row.platform === 'META')
      .reduce(
        (acc, row) => ({
          impressions: acc.impressions + row.impressions,
          clicks: acc.clicks + row.clicks,
          spend: acc.spend + Number(row.spend),
        }),
        {
          impressions: 0,
          clicks: 0,
          spend: 0,
        }
      ),

    GOOGLE: dailyRows
      .filter((row) => row.platform === 'GOOGLE')
      .reduce(
        (acc, row) => ({
          impressions: acc.impressions + row.impressions,
          clicks: acc.clicks + row.clicks,
          spend: acc.spend + Number(row.spend),
        }),
        {
          impressions: 0,
          clicks: 0,
          spend: 0,
        }
      ),
  };

  return {
    campaignId,
    totals,
    byPlatform,
    daily: dailyRows,
  };
}