import { ObjectId } from "mongodb";
import { getMongo } from "../lib/mongo";

export const ANALYTICS_EVENT_TYPES = [
  "PAGE_VIEW",
  "INQUIRY_SUBMITTED",
  "BOOKING_CONFIRMED",
  "BOOKING_PAID",
  "BOOKING_CANCELLED",
] as const;

export type AnalyticsEventType = typeof ANALYTICS_EVENT_TYPES[number];

export interface AnalyticsEvent {
  _id?:       ObjectId;
  agency_id:  string;
  event_type: AnalyticsEventType;
  trekker_id: string | null;
  package_id: string | null;
  timestamp:  Date;
  metadata:   Record<string, unknown>;
}

export interface DailyAgencySummary {
  _id?:          ObjectId;
  date:          string;
  agency_id:     string;
  new_inquiries: number;
  confirmed:     number;
  revenue:       number;
  cancelled:     number;
  updated_at:    Date;
}

export async function getAnalyticsCollection() {
  const db = await getMongo();
  return db.collection<AnalyticsEvent>("analytics_events");
}

export async function getDailySummaryCollection() {
  const db = await getMongo();
  return db.collection<DailyAgencySummary>("daily_agency_summaries");
}

export async function ensureAnalyticsIndexes(): Promise<void> {
  try {
    const events  = await getAnalyticsCollection();
    const summary = await getDailySummaryCollection();

    await events.createIndex({ agency_id: 1, timestamp: -1 });
    await events.createIndex({ event_type: 1, timestamp: -1 });
    await events.createIndex({ trekker_id: 1 });
    await events.createIndex({ package_id: 1 });

    await summary.createIndex({ agency_id: 1, date: -1 });
    await summary.createIndex({ agency_id: 1, date: 1 }, { unique: true });

    console.log("[Analytics] MongoDB indexes ensured");
  } catch (err) {
    console.error("[Analytics] Failed to ensure indexes:", err);
  }
}
