/**
 * The Funtush API application.
 *
 * This module builds and exports the configured Express app but does NOT listen
 * or start background jobs — `index.ts` does that. Tests import `{ app }` (or
 * call `createApp()`) directly.
 */
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { MulterError } from "multer";
import swaggerUi from "swagger-ui-express";

import { db, redis } from "@funtush/database";

// ── Middleware ──────────────────────────────────────────────────────────────
import { requestLogger } from "./middleware/requestLogger.middleware";
import { resolveTenant } from "./middleware/resolveTenant.middleware";
import { rateLimitMiddleware } from "./middleware/rateLimit.middleware";
import { authenticateWithRefreshToken } from "./middleware/refreshTokenAuthentication";

// ── Routers ─────────────────────────────────────────────────────────────────
import uploadRoutes from "./routes/upload.routes";
import authRoutes from "./routes/auth.routes";
import agencyRoutes from "./routes/agency.routes";
import agencyCustomerRoutes from "./routes/agencyCustomer.routes";
import reviewRoutes from "./routes/review.route";
import couponRoutes from "./routes/coupon.route";
import branchRoutes from "./routes/branches.routes";
import brandingRoutes from "./routes/branding.routes";
import siteConfigRoutes from "./routes/siteConfig.routes";
import navigationRoutes from "./routes/navigation.routes";
import regenerationRoutes from "./routes/regeneration.routes";
import widgetsRoutes from "./routes/widgets/widgets.routes";
import instagramRoutes from "./routes/widgets/instagram.routes";
import trekkerRoutes from "./routes/trekker.routes";
import packageRoutes from "./routes/package.routes";
import rolesRoutes from "./routes/roles.routes";
import guidesRoutes from "./routes/guides.routes";
import blogRoutes from "./routes/blog.routes";
import mediaRoutes from "./routes/media.routes";
import agencyDestinationRoutes from "./routes/agencyDestination.routes";
import siteAdRoutes from "./routes/siteAd.routes";
import safetyRoutes from "./routes/safety.routes";
import financeRoutes from "./routes/finance.route";
import agencyAnalyticsRoutes from "./routes/agencyAnalytics.routes";
import agencyAnalyticsOverviewRoutes from "./routes/agency/analytics.route";
import reportsRouter from "./routes/agency/reports.route";
import staffRoutes from "./routes/staff.routes";
import paymentMethodsRoutes from "./routes/paymentMethods";
import adCampaignRoutes from "./routes/adCampaign.routes";
import apiKeyRoutes from "./routes/apiKey.routes";
import publicApiRoutes from "./routes/publicApi.routes";
import bugRoutes from "./routes/bug.routes";
import billingRoutes from "./routes/billing.routes";
import marketplaceRoutes from "./routes/marketplace.routes";
import mobileRoutes from "./routes/mobile.routes";
import bookingRoutes from "./routes/booking.routes";
import emailRoutes from "./routes/emailRoutes";
import sosRoutes from "./routes/sosRoutes";
import adminRoutes from "./routes/admin/index";
import paymentWebhookRoutes from "./routes/payment.webhook.routes";
import stripeWebhookRoutes from "./routes/webhooks/stripe";

import { openapiSpec } from "./docs/openapi";

const docsEnabled =
  process.env.NODE_ENV !== "production" || process.env.ENABLE_DOCS === "true";

export function createApp(): Express {
  const app = express();

  // 1. Payment webhooks need the RAW request body for signature verification,
  //    so they must be mounted before express.json() consumes the stream.
  //    (Each router applies express.raw() to its own routes.)
  app.use("/webhooks/payment", paymentWebhookRoutes);
  app.use("/webhooks", stripeWebhookRoutes);

  // 2. Everything else is JSON.
  app.use(express.json());

  // 3. Cross-cutting middleware.
  app.use(requestLogger);
  app.use(resolveTenant);
  app.use(rateLimitMiddleware);

  // 4. Health + docs.
  app.get("/health", async (_req: Request, res: Response) => {
    // A liveness probe must always answer quickly — bound every dependency
    // check so a hung/unreachable dependency reports "error" instead of
    // stalling the request (some Redis clients queue rather than reject).
    const withTimeout = <T>(p: Promise<T>, ms = 1500): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
      ]);

    const [dbOk, redisOk] = await Promise.all([
      withTimeout(db.$queryRaw`SELECT 1`).then(() => true).catch(() => false),
      withTimeout(Promise.resolve(redis.ping())).then((r) => r === "PONG").catch(() => false),
    ]);
    const ok = dbOk && redisOk;
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "error",
      db: dbOk ? "ok" : "error",
      redis: redisOk ? "ok" : "error",
    });
  });

  if (docsEnabled) {
    app.get("/docs.json", (_req, res) => res.json(openapiSpec));
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
  }

  // 5. Feature routers. Several declare fully-qualified paths and are mounted at
  //    "/" — order is not significant between them as long as concrete paths
  //    don't collide (asserted by app.smoke.test.ts).
  app.use("/", uploadRoutes);
  app.use("/auth", authRoutes);
  app.use("/", agencyRoutes);
  app.use("/", agencyCustomerRoutes);
  app.use("/", reviewRoutes);
  app.use("/", couponRoutes);
  app.use("/", branchRoutes);
  // White-label: brand identity, site config (under-construction / top bar /
  // popup / badge), navigation builder, static-site regeneration.
  app.use("/", brandingRoutes);
  app.use("/", siteConfigRoutes);
  app.use("/", navigationRoutes);
  app.use("/", regenerationRoutes);
  app.use("/", instagramRoutes);
  app.use("/", trekkerRoutes);
  app.use("/", packageRoutes);
  app.use("/", rolesRoutes);
  app.use("/", guidesRoutes);
  app.use("/", blogRoutes);
  app.use("/", mediaRoutes);
  app.use("/", agencyDestinationRoutes);
  app.use("/", siteAdRoutes);
  app.use("/", safetyRoutes);
  app.use("/", financeRoutes);
  app.use("/", agencyAnalyticsRoutes);

  app.use("/agencies/me/widgets", widgetsRoutes);
  app.use("/agencies/me/analytics", authenticateWithRefreshToken, agencyAnalyticsOverviewRoutes);
  app.use("/agencies/me/reports", authenticateWithRefreshToken, reportsRouter);
  app.use("/agencies/me/staff", staffRoutes);
  app.use("/agencies/me/payment-methods", paymentMethodsRoutes);
  app.use("/agencies/me/ad-campaigns", adCampaignRoutes);
  app.use("/agencies/me/api-keys", apiKeyRoutes);
  app.use("/agencies/me/bugs", bugRoutes);
  app.use("/public-api/v1", publicApiRoutes);
  app.use("/billing", billingRoutes);

  app.use("/marketplace", marketplaceRoutes);
  app.use("/mobile", mobileRoutes);
  app.use("/bookings", bookingRoutes);
  app.use("/emails", emailRoutes);
  app.use("/sos", sosRoutes);

  app.use("/admin", adminRoutes);
  app.use("/admin/bugs", bugRoutes); // same router, super-admin sub-routes
  // NOTE: the fraud review queue is mounted at /admin/fraud via adminRoutes
  // (behind requireAdmin). It used to also be mounted unprotected at "/fraud" —
  // removed, since ban/blocklist actions must be admin-only.

  // 6. Error handler — must be last.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Max 10MB allowed." });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    if (message.includes("Invalid file type")) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: message });
  });

  return app;
}

export const app = createApp();
export default app;
