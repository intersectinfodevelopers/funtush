import type { ObjectId } from "mongodb";

/** Delivery channels supported by the notification system. */
export type NotificationChannel = "push" | "email" | "in_app" | "sms";

/** Priority levels. CRITICAL bypasses Do Not Disturb. */
export type NotificationPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/** Who is receiving this notification. */
export type RecipientType = "user" | "agency" | "admin";

/** Event types known to the system. Extend the matrix when adding new ones. */
export type NotificationEventType =
  | "SOS_ALERT"
  | "PAYMENT_FAILED"
  | "BOOKING_CONFIRMED"
  | "BOOKING_CANCELLED"
  | "KYC_APPROVED"
  | "KYC_REJECTED"
  | "TRIP_REMINDER"
  | "NEW_MESSAGE"
  | "PROMO";

export type NotificationStatus = "pending" | "sent" | "partial" | "failed";

/** Per-channel delivery result recorded on the event document. */
export interface ChannelResult {
  channel: NotificationChannel;
  ok: boolean;
  error?: string;
  delivered_at?: Date;
}

/** MongoDB document — collection: notification_events */
export interface NotificationEventDoc {
  _id?: ObjectId;
  recipient_id: string;
  recipient_type: RecipientType;
  event_type: NotificationEventType;
  channels: NotificationChannel[];
  priority: NotificationPriority;
  status: NotificationStatus;
  payload: Record<string, unknown>;
  results: ChannelResult[];
  created_at: Date;
  sent_at?: Date;
}

/** Payload accepted by notifyUser. */
export interface NotifyPayload {
  title: string;
  body: string;
  /** Extra data sent to FCM `data` field / stored for in-app rendering. */
  data?: Record<string, string>;
  /** Optional email override; if omitted, email channel looks up the user. */
  email?: string;
}