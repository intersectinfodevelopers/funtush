import express from "express";
import { db, redis } from "@funtush/database";
import { resolveTenant } from "./middleware/resolveTenant.middleware.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.middleware.js";
import { requestLogger } from "./middleware/requestLogger.middleware.js";
import adminRouter from "./routes/admin/index.js";
import agencyRoutes from "./routes/agency.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job.js";

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
app.use("/", agencyRoutes);
app.use("/bookings", bookingRoutes);

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  startSubscriptionCron();
}

export default app;