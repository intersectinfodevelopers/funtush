import {
  AnalyticsEventType,
  DailyAgencySummary,
  getAnalyticsCollection,
  getDailySummaryCollection,
} from "../models/analyticsEvent.model";

/**
 * Track a single analytics event.
 * Fire-and-forget — never throws, so route handlers are never affected.
 */
export async function trackEvent(params: {
  agency_id:   string;
  event_type:  AnalyticsEventType;
  trekker_id?: string | null;
  package_id?: string | null;
  metadata?:   Record<string, unknown>;
}): Promise<void> {
  try {
    const col = await getAnalyticsCollection();
    await col.insertOne({
      agency_id:  params.agency_id,
      event_type: params.event_type,
      trekker_id: params.trekker_id ?? null,
      package_id: params.package_id ?? null,
      timestamp:  new Date(),
      metadata:   params.metadata ?? {},
    });
  } catch (err) {
    console.error("[Analytics] Failed to track event:", err);
  }
}

/**
 * Rebuild the DailyAgencySummary for a given agency and date.
 * Called nightly by the cron job (or immediately on booking events).
 */
export async function upsertDailySummary(
  agency_id: string,
  date: string  // "YYYY-MM-DD"
): Promise<void> {
  try {
    const events = await getAnalyticsCollection();
    const summary = await getDailySummaryCollection();

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd   = new Date(`${date}T23:59:59.999Z`);

    const filter = {
      agency_id,
      timestamp: { $gte: dayStart, $lte: dayEnd },
    };

   const [inquiries, confirmed, _paid, cancelled] = await Promise.all([
      events.countDocuments({ ...filter, event_type: "INQUIRY_SUBMITTED" }),
      events.countDocuments({ ...filter, event_type: "BOOKING_CONFIRMED" }),
      events.countDocuments({ ...filter, event_type: "BOOKING_PAID" }),
      events.countDocuments({ ...filter, event_type: "BOOKING_CANCELLED" }),
    ]);

    // Sum revenue from metadata.amount on BOOKING_PAID events
    const paidEvents = await events
      .find({ ...filter, event_type: "BOOKING_PAID" })
      .toArray();
    const revenue = paidEvents.reduce((sum: number, e) => {
      const amount = typeof e.metadata.amount === "number" ? e.metadata.amount : 0;
      return sum + amount;
    }, 0);

    const doc: Omit<DailyAgencySummary, "_id"> = {
      date,
      agency_id,
      new_inquiries: inquiries,
      confirmed,
      revenue,
      cancelled,
      updated_at: new Date(),
    };

    await summary.updateOne(
      { agency_id, date },
      { $set: doc },
      { upsert: true }
    );
  } catch (err) {
    console.error("[Analytics] Failed to upsert daily summary:", err);
  }
}

/**
 * Returns analytics events for a given agency, optionally filtered by type.
 */
export async function getAgencyEvents(
  agency_id:   string,
  event_type?: AnalyticsEventType,
  limit        = 100
) {
  const col    = await getAnalyticsCollection();
  const filter = event_type ? { agency_id, event_type } : { agency_id };
  return col.find(filter).sort({ timestamp: -1 }).limit(limit).toArray();
}

/**
 * Returns daily summaries for a given agency over a date range.
 */
export async function getAgencyDailySummaries(
  agency_id: string,
  from:      string,  // "YYYY-MM-DD"
  to:        string   // "YYYY-MM-DD"
) {
  const col = await getDailySummaryCollection();
  return col
    .find({ agency_id, date: { $gte: from, $lte: to } })
    .sort({ date: 1 })
    .toArray();
}
