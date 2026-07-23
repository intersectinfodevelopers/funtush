import express from "express";
import { db, redis } from "@funtush/database";
import { resolveTenant } from "./middleware/resolveTenant.middleware";
import { rateLimitMiddleware } from "./middleware/rateLimit.middleware";
import { requestLogger } from "./middleware/requestLogger.middleware";
import adminRouter from "./routes/admin/index";
import agencyRoutes from "./routes/agency.routes";
import bookingRoutes from "./routes/booking.routes";
import paymentWebhookRoutes from "./routes/payment.webhook.routes";
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";
import reportsRouter from "./routes/agency/reports.route";
import billingRoutes from './routes/billing.routes';
import stripeWebhookRoutes from './routes/webhooks/stripe';

const app = express();  

app.use(express.json());
app.use(requestLogger);

app.get("/health", async (_req, res) => {
  const [dbStatus, redisStatus] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => "ok" as const).catch(() => "error" as const),
    redis.ping().then(() => "ok" as const).catch(() => "error" as const),
  ]);

  const allOk = dbStatus === "ok" && redisStatus === "ok";

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "error",
    db: dbStatus,
    redis: redisStatus,
  });
});

app.post("/sos", (_req, res) => {
  res.json({ status: "SOS received" });
});

app.use(resolveTenant);
app.use(rateLimitMiddleware);
app.use("/admin", adminRouter);
app.use("/agencies/me/reports", reportsRouter);
app.use("/", agencyRoutes);
app.use("/bookings", bookingRoutes);
app.use("/webhooks/payment", paymentWebhookRoutes);


app.use('/billing', billingRoutes);
app.use('/webhooks', stripeWebhookRoutes);

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  startSubscriptionCron();
}

export default app;