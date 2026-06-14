import type { Request, Response, NextFunction } from "express";
import { trackEvent } from "../services/analytics.service";
import { upsertDailySummary } from "../services/analytics.service";
import type { AnalyticsEventType } from "../models/analyticsEvent.model";

/**
 * Maps booking status transitions to analytics event types.
 */
const STATUS_TO_EVENT: Record<string, AnalyticsEventType> = {
  CONFIRMED: "BOOKING_CONFIRMED",
  PAID:      "BOOKING_PAID",
  CANCELLED: "BOOKING_CANCELLED",
};

/**
 * Intercepts booking state change responses and fires analytics events
 * automatically — no manual calls needed in route handlers.
 *
 * Attach to any route that changes booking status:
 *   router.patch("/:id/status", bookingAnalyticsMiddleware, handler)
 *
 * Or wrap the whole bookings router:
 *   app.use("/bookings", bookingAnalyticsMiddleware, bookingsRouter)
 */
export function bookingAnalyticsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown): Response {
    // Only fire on successful state-change responses
    if (res.statusCode >= 200 && res.statusCode < 300 && body && typeof body === "object") {
      const data = body as Record<string, unknown>;
      const status     = data.status     as string | undefined;
      const agencyId   = req.agencyId    ?? (data.agencyId as string | undefined);
      const trekkerId  = data.trekkerId  as string | undefined;
      const packageId  = data.packageId  as string | undefined;
      const bookingId  = data.id         as string | undefined;
      const amount     = data.totalAmount as number | undefined;

      const eventType = status ? STATUS_TO_EVENT[status.toUpperCase()] : undefined;

      if (eventType && agencyId) {
        // Fire-and-forget — do not await
        trackEvent({
          agency_id:  agencyId,
          event_type: eventType,
          trekker_id: trekkerId ?? null,
          package_id: packageId ?? null,
          metadata: {
            booking_id: bookingId,
            status,
            amount,
            method:  req.method,
            path:    req.path,
          },
        });

        // Trigger nightly summary update for today
        const today = new Date().toISOString().split("T")[0];
        upsertDailySummary(agencyId, today);
      }
    }

    return originalJson(body);
  };

  next();
}

/**
 * Tracks PAGE_VIEW events. Attach to any route that serves content.
 */
export function pageViewMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const agencyId = req.agencyId;
  if (agencyId) {
    trackEvent({
      agency_id:  agencyId,
      event_type: "PAGE_VIEW",
      trekker_id: null,
      package_id: req.params.packageId ?? null,
      metadata: {
        method: req.method,
        path:   req.path,
        query:  req.query,
      },
    });
  }
  next();
}

/**
 * Tracks INQUIRY_SUBMITTED events on inquiry creation routes.
 */
export function inquiryAnalyticsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown): Response {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.agencyId) {
      const data = body as Record<string, unknown>;
      trackEvent({
        agency_id:  req.agencyId,
        event_type: "INQUIRY_SUBMITTED",
        trekker_id: (data.trekkerId as string) ?? null,
        package_id: (data.packageId as string) ?? null,
        metadata: {
          inquiry_id: data.id,
          path:       req.path,
        },
      });

      const today = new Date().toISOString().split("T")[0];
      upsertDailySummary(req.agencyId, today);
    }
    return originalJson(body);
  };

  next();
}
