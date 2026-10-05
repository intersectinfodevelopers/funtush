/**
 * The Funtush API application.
 *
 * This module builds and exports the configured Express app but does NOT listen
 * or start background jobs — `index.ts` does that. Tests import `{ app }` (or
 * call `createApp()`) directly.
 */
import "./lib/asyncErrors";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { MulterError } from "multer";
import cors from "cors";
import { useLocalStorage, localUploadDir } from "@funtush/storage";

import { db, redis } from "@funtush/database";

// ── Middleware ──────────────────────────────────────────────────────────────
import { requestLogger } from "./middleware/requestLogger.middleware";
import { resolveTenant } from "./middleware/resolveTenant.middleware";
import { rateLimitMiddleware } from "./middleware/rateLimit.middleware";
import { impersonationAuditMiddleware } from "./middleware/impersonationAudit.middleware";
import { authenticateWithRefreshToken } from "./middleware/refreshTokenAuthentication";
import { metricsMiddleware, metricsRouter } from "./services/prometheusMetrics";
import { loadShedding } from "./middleware/loadShedding.middleware";
import { securityHeaders } from "./middleware/securityHeaders.middleware";
import { sanitizeServerErrors } from "./middleware/sanitizeServerErrors.middleware";

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
import socialLinksRoutes from "./routes/socialLinks.routes";
import seoSettingsRoutes from "./routes/seoSettings.routes";
import notificationPreferencesRoutes from "./routes/notificationPreferences.routes";
import emailSettingsRoutes from "./routes/emailSettings.routes";
import domainRoutes from "./routes/domain.routes";
import sitePageRoutes from "./routes/sitePage.routes";
import siteContentRoutes from "./routes/siteContent.routes";
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

import { mountSwaggerDocs } from "./docs/swaggerUi";

const docsEnabled =
  process.env.NODE_ENV !== "production" || process.env.ENABLE_DOCS === "true";

// No browser-facing frontend could call this API cross-origin at all before
// this (no `cors` package, no CORS headers set anywhere) — confirmed while
// wiring funtush-admin's real login: it works over curl (which doesn't
// enforce CORS) but is silently blocked from an actual browser without
// this. Origins are configurable via CORS_ALLOWED_ORIGINS (comma-separated)
// for deployed environments; defaults cover the local frontend dev ports.
const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS ??
  "http://localhost:3000,http://localhost:3001,http://localhost:3002"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function createApp(): Express {
  const app = express();

  // Client IP comes from `req.ip`, which Express derives from X-Forwarded-For
  // ONLY across this many trusted proxy hops, counting from the right (the
  // address our own proxy actually saw). Reading the *first* header value —
  // as this used to — lets any client pick its own IP by sending the header,
  // which bypassed every rate limit (login, OTP) and the admin IP whitelist
  // (`X-Forwarded-For: 127.0.0.1`). Set TRUSTED_PROXY_HOPS=0 if the API is
  // exposed directly with no proxy in front.
  app.set("trust proxy", Number(process.env.TRUSTED_PROXY_HOPS ?? 1));
  // `simple` = Node querystring: `?status[not]=X` stays a flat key instead of becoming
  // the object { status: { not: "X" } }. With qs's nested parsing, any handler that
  // passes a query value into a Prisma `where` lets the caller inject operators
  // (not/in/contains/…) instead of supplying a value.
  app.set("query parser", "simple");
  app.disable("x-powered-by"); // don't advertise the framework to scanners

  // 0. CORS, ahead of everything else so a preflight (OPTIONS) request never
  //    reaches route-matching at all.
  // Public, cookie-less routes an agency's own website calls from ITS origin — `{slug}.funtush.io`, a custom
  // domain, a preview URL — so no fixed allow-list can cover them. Safe to open to any origin: no
  // credentials are ever accepted here (`Access-Control-Allow-Credentials` is not sent) and they expose
  // only what the agency already publishes, or take a form that verifies by emailed code.
  // Local dev without an object store: serve the files the uploader wrote to disk (see @funtush/storage).
  if (useLocalStorage()) {
    app.use("/cdn", (_req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      next();
    }, express.static(localUploadDir(), { index: false, dotfiles: "ignore" }));
  }
  app.use(["/site", "/bookings/inquiry"], cors({ origin: "*", methods: ["GET", "POST", "HEAD", "OPTIONS"], maxAge: 600 }));
  app.use(cors({ origin: allowedOrigins, credentials: true }));

  app.use(securityHeaders);

  // Refuse excess load early (before any parsing/DB work) — see the middleware.
  app.use(loadShedding);

  // 1. Payment webhooks need the RAW request body for signature verification,
  //    so they must be mounted before express.json() consumes the stream.
  //    (Each router applies express.raw() to its own routes.)
  app.use("/webhooks/payment", paymentWebhookRoutes);
  app.use("/webhooks", stripeWebhookRoutes);

  // 2. Everything else is JSON.
  app.use(express.json());

  // 3. Cross-cutting middleware. metricsMiddleware first, so its timing
  // wraps the whole request (including requestLogger's own overhead), not
  // just what runs after it.
  app.use(metricsMiddleware);
  app.use(sanitizeServerErrors);
  app.use(requestLogger);
  app.use(resolveTenant);
  app.use(rateLimitMiddleware);
  // Registered before any route's own auth middleware runs, but it doesn't
  // read req.user until res.on("finish") fires — by then, whichever auth
  // middleware the matched route used has already run. See the file for why
  // that ordering trick is what makes this work without touching every
  // route file.
  app.use(impersonationAuditMiddleware);

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
    mountSwaggerDocs(app);
  }

  // Prometheus scrape target — request rate/latency/error-rate, labeled by
  // method + route pattern (not raw URLs, so ids don't blow up cardinality).
  // Not gated behind docsEnabled (a scraper needs it in production), but it
  // authenticates itself: see the METRICS_TOKEN handling in prometheusMetrics.ts.
  app.use(metricsRouter);

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
  app.use("/", socialLinksRoutes);
  app.use("/", seoSettingsRoutes);
  app.use("/", notificationPreferencesRoutes);
  app.use("/", emailSettingsRoutes);
  app.use("/", domainRoutes);
  app.use("/", sitePageRoutes);
  app.use("/", siteContentRoutes);
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
    // Too many files / unexpected field name are the caller's mistake, not a 500.
    if (err instanceof MulterError) {
      return res.status(400).json({ error: "Invalid upload request." });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    if (message.includes("Invalid file type")) {
      return res.status(400).json({ error: message });
    }
    // Honor a status the error carries (404 "Staff not found", 409, …) instead of
    // flattening everything to 500. Only 4xx/5xx values are trusted.
    const carried = (err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode;
    const status = typeof carried === "number" && carried >= 400 && carried < 600 ? carried : 500;
    return res.status(status).json({ error: message });
  });

  return app;
}

export const app = createApp();
export default app;
