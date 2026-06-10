import { getMongo } from "../lib/mongo";

export interface RequestLog {
  requestId:    string;
  method:       string;
  path:         string;
  statusCode:   number;
  responseTime: number;
  ip:           string;
  tenantId?:    string | null;
  agencyId?:    string | null;
  userAgent?:   string;
  timestamp:    Date;
}

export async function saveRequestLog(log: RequestLog): Promise<void> {
  try {
    const db = await getMongo();
    await db.collection("request_logs").insertOne(log);
  } catch (err) {
    console.error("[Logger] Failed to save log:", err);
  }
}