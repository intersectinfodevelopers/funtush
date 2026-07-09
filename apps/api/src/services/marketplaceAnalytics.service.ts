import { prisma } from "@funtush/database";
import { startOfDay, subDays } from "date-fns";


export async function recordImpression(agencyId: string) {
  const today = startOfDay(new Date());

  const impression = await prisma.marketplaceImpression.upsert({
    where: {
      agencyId_date: {
        agencyId,
        date: today,
      },
    },
    update: {
      impressionCount: {
        increment: 1,
      },
    },
    create: {
      agencyId,
      date: today,
      impressionCount: 1,
      clickCount: 0,
      conversionCount: 0,
    },
  });

  return impression;
}


export async function recordClick(
  agencyId: string,
  treklerId: string | null | undefined,
  destination: string,
  searchQuery?: string
) {
  const today = startOfDay(new Date());
  await prisma.marketplaceImpression.upsert({
    where: {
      agencyId_date: {
        agencyId,
        date: today,
      },
    },
    create: {
      agencyId,
      date: today,
      impressionCount: 0,
      clickCount: 1,
    },
    update: {
      clickCount: {
        increment: 1,
      },
    },
  });

  // Log the granular click event (for conversion attribution and analytics)
  const click = await prisma.marketplaceClick.create({
    data: {
      agencyId,
      treklerId: treklerId || null, // null for anonymous
      destination,
      searchQuery: searchQuery || null,
    },
  });

  return click;
}

/**
 * Record a conversion when an inquiry is created from a marketplace click.
 * Called in the createInquiry flow (or after inquiry → booking acceptance).
 * 
 * Updates conversionCount in today's MarketplaceImpression.
 */
export async function recordConversion(agencyId: string) {
  const today = startOfDay(new Date());

  const impression = await prisma.marketplaceImpression.updateMany({
    where: {
      agencyId,
      date: today,
    },
    data: {
      conversionCount: {
        increment: 1,
      },
    },
  });

  return impression;
}

/**
 * Fetch marketplace impressions for an agency over a period.
 * Returns daily breakdown + aggregated CTR and conversion rate.
 */
export async function getAgencyMarketplaceImpressions(
  agencyId: string,
  period: "last_7_days" | "last_30_days" | "last_90_days" = "last_30_days"
) {
  const daysBack = period === "last_7_days" ? 7 : period === "last_30_days" ? 30 : 90;
  const startDate = startOfDay(subDays(new Date(), daysBack));

  const impressions = await prisma.marketplaceImpression.findMany({
    where: {
      agencyId,
      date: {
        gte: startDate,
      },
    },
    orderBy: {
      date: "desc",
    },
  });

  // Aggregate stats across all days in period
  const totalImpressions = impressions.reduce(
    (sum: number, imp: typeof impressions[number]) => sum + imp.impressionCount,
    0
  );

  const totalClicks = impressions.reduce(
    (sum: number, imp: typeof impressions[number]) => sum + imp.clickCount,
    0
  );

  const totalConversions = impressions.reduce(
    (sum: number, imp: typeof impressions[number]) => sum + imp.conversionCount,
    0
  );
  const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0.00";
  const conversionRate =
    totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(2) : "0.00";

  return {
    period,
    summary: {
      totalImpressions,
      totalClicks,
      ctr: `${ctr}%`,
      totalConversions,
      conversionRate: `${conversionRate}%`,
    },
    byDay: impressions, 
  };
}

export async function getAgencyMarketplaceConversions(agencyId: string, windowHours: number = 24) {
  const thirtyDaysAgo = subDays(new Date(), 30);

  // Fetch all clicks for this agency in last 30 days
  const clicks = await prisma.marketplaceClick.findMany({
    where: {
      agencyId,
      timestamp: {
        gte: thirtyDaysAgo,
      },
    },
    orderBy: {
      timestamp: "desc",
    },
  });

  // Fetch all bookings/inquiries created in last 30 days
  const bookings = await prisma.booking.findMany({
    where: {
      agencyId,
      createdAt: {
        gte: thirtyDaysAgo,
      },
    },
    select: {
      id: true,
      createdAt: true,
      trekkerId: true,
      status: true,
      trekkerEmail: true,
    },
  });

  // Link clicks to bookings: same trekker + booking within conversion window
  const windowMs = windowHours * 3600000;
  const conversions = clicks
    .map((click: typeof clicks[number]) => {
      const linkedBooking = click.treklerId
        ? bookings.find(
            (booking: typeof bookings[number]) =>
              booking.trekkerId !== null &&
              booking.trekkerId === click.treklerId && // Same trekker, both non-null
              booking.createdAt.getTime() - click.timestamp.getTime() >= 0 && // Booking after click
              booking.createdAt.getTime() - click.timestamp.getTime() <= windowMs // Within conversion window
          )
        : undefined; // anonymous click — cannot be attributed to any booking

      return {
        clickId: click.id,
        clickTimestamp: click.timestamp,
        destination: click.destination,
        searchQuery: click.searchQuery,
        converted: !!linkedBooking,
        bookingId: linkedBooking?.id || null,
        bookingStatus: linkedBooking?.status || null,
        bookingCreatedAt: linkedBooking?.createdAt || null,
      };
    })
    .filter((c: typeof conversions[number]) => c.converted); // Only return conversions

  const conversionRate =
    clicks.length > 0 ? ((conversions.length / clicks.length) * 100).toFixed(2) : "0.00";

  return {
    period: "last_30_days",
    summary: {
      totalClicks: clicks.length,
      conversions: conversions.length,
      conversionRate: `${conversionRate}%`,
      conversionWindowHours: windowHours,
    },
    details: conversions,
  };
}

/**
 * Fetch top-performing agencies by impressions over a period.
 * Used for admin dashboards or featured content curation.
 */
export async function getTopAgenciesByImpressions(
  period: "last_7_days" | "last_30_days" = "last_7_days",
  limit: number = 10
) {
  const daysBack = period === "last_7_days" ? 7 : 30;
  const startDate = startOfDay(subDays(new Date(), daysBack));

  const results = await prisma.marketplaceImpression.groupBy({
    by: ["agencyId"],
    where: {
      date: {
        gte: startDate,
      },
    },
    _sum: {
      impressionCount: true,
      clickCount: true,
      conversionCount: true,
    },
    orderBy: {
      _sum: {
        impressionCount: "desc",
      },
    },
    take: limit,
  });

  // Enrich with agency details
  const enriched = await Promise.all(
    results.map(async (r: typeof results[number]) => {
      const agency = await prisma.agency.findUnique({
        where: { id: r.agencyId },
        select: { id: true, name: true, slug: true, tier: true },
      });
      return {
        agencyId: r.agencyId,
        agencyName: agency?.name,
        agencySlug: agency?.slug,
        tier: agency?.tier?.name,
        impressions: r._sum.impressionCount || 0,
        clicks: r._sum.clickCount || 0,
        conversions: r._sum.conversionCount || 0,
        ctr:
          (r._sum.impressionCount || 0) > 0
            ? (((r._sum.clickCount || 0) / (r._sum.impressionCount || 0)) * 100).toFixed(2)
            : "0.00",
      };
    })
  );

  return {
    period,
    limit,
    data: enriched,
  };
}