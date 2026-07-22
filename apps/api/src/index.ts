import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { MulterError } from "multer";

import uploadRoutes from "./routes/upload.routes.js";
import authRoutes from "./routes/auth.routes.js";
import agencyRoutes from "./routes/agency.routes.js";
import packageRoutes from "./routes/package.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import agencyCustomerRoutes from "./routes/agencyCustomer.routes.js";
import trekkerRoutes from "./routes/trekker.routes.js";
import marketplaceRoutes from "./routes/marketplace.routes.js";
import reviewRoutes from "./routes/review.route.js";
import couponRoutes from "./routes/coupon.route.js";
import financeRoutes from "./routes/finance.route.js";
import staffRoutes from "./routes/staff.routes";
import adminRoutes from "./routes/admin/index.js";
import agencyAnalyticsRoutes from "./routes/agencyAnalytics.routes.js";
import fraudRouter from "./routes/admin/fraud.route.js";

// NEW: Email & SOS Routes
import emailRoutes from "./routes/emailRoutes.js";
import sosRoutes from "./routes/sosRoutes.js";

import { startVisibilityScoreCron } from "./jobs/visibilityScore.job.js";
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job.js";
import { configureIndexes } from "./services/search.service.js";
import {
  initNotificationService,
  ensureNotificationIndexes,
} from "./services/notificationDispatch.service";
import { db, redis, connectMongo } from "@funtush/database";

const app = express();
const port = Number(process.env.PORT ?? 4000);

// Middleware
app.use(express.json());

// Routes
app.use("/", uploadRoutes);
app.use("/", agencyRoutes);
app.use("/", agencyCustomerRoutes);
app.use("/", trekkerRoutes);
app.use("/", packageRoutes);
app.use("/marketplace", marketplaceRoutes);
app.use("/bookings", bookingRoutes);
app.use("/auth", authRoutes);
app.use("/agencies/me/staff", staffRoutes);
app.use("/admin", adminRoutes);
app.use("/fraud", fraudRouter);

// Analytics Routes
app.use("/", agencyAnalyticsRoutes);

app.use("/", reviewRoutes);
app.use("/", couponRoutes);
app.use("/", financeRoutes);

// NEW: Email & SOS Routes
app.use("/emails", emailRoutes);
app.use("/sos", sosRoutes);

app.get("/health", async (_req: Request, res: Response) => {
  const [dbOk, redisOk] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis.ping().then((r) => r === "PONG").catch(() => false),
  ]);

  const ok = dbOk && redisOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "error",
    db: dbOk ? "ok" : "error",
    redis: redisOk ? "ok" : "error",
  });
});

// Global error handler
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

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  void (async () => {
    try {
      // Notification service needs the *Mongo* Db instance from the Mongoose
      // connection, not the Prisma client `db`.
      const mongoDb = await connectMongo();
      initNotificationService(mongoDb);
      await ensureNotificationIndexes();
    } catch (err) {
      console.error("Notification service init failed:", err);
    }
  })();

  startSubscriptionCron();
  startVisibilityScoreCron();

  // Ensure Meilisearch indexes + settings exist on boot (idempotent, non-blocking).
  configureIndexes().catch(console.error);

  app.listen(port, () => {
    console.log(`Funtush API listening on port ${port}`);
  });
}

export { app };