import { getMongo } from "./mongo";
import { Collection, ObjectId } from "mongodb";

export type EmailStatus = "pending" | "sent" | "failed";

export interface EmailQueueDocument {
  _id?: ObjectId;
  to: string;
  subject: string;
  body: string;
  status: EmailStatus;
  retry_count: number;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

async function getEmailCollection(): Promise<Collection<EmailQueueDocument>> {
  const db = await getMongo();
  return db.collection<EmailQueueDocument>("email_queue");
}

/**
 * Saves a new email to the EmailQueue with status "pending".
 * Returns the inserted document's id.
 */
export async function queueEmail(
  to: string,
  subject: string,
  body: string
): Promise<string> {
  const col = await getEmailCollection();

  const now = new Date();
  const doc: EmailQueueDocument = {
    to,
    subject,
    body,
    status: "pending",
    retry_count: 0,
    createdAt: now,
    updatedAt: now,
  };

  const result = await col.insertOne(doc);
  return result.insertedId.toHexString();
}

/**
 * Fetches emails from the queue, optionally filtered by status.
 */
export async function getEmailQueue(
  filter: { status?: EmailStatus | EmailStatus[] } = {}
): Promise<EmailQueueDocument[]> {
  const col = await getEmailCollection();

  const query: Record<string, unknown> = {};
  if (filter.status) {
    if (Array.isArray(filter.status)) {
      query.status = { $in: filter.status };
    } else {
      query.status = filter.status;
    }
  }

  return col.find(query).sort({ createdAt: -1 }).toArray();
}
