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

import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job.js";
import { configureIndexes } from "./services/search.service.js";

import { db, redis , connectMongo} from "@funtush/database";

import staffRoutes from "./routes/staff.routes";




const app = express();
// app.use(express.json())
const port = Number(process.env.PORT ?? 4000);

//Middleware

app.use(express.json());

//Routes
app.use("/", uploadRoutes);
app.use('/', agencyRoutes);
app.use('/', agencyCustomerRoutes);
app.use('/', trekkerRoutes);
app.use("/", packageRoutes);
app.use("/marketplace", marketplaceRoutes);
app.use("/bookings", bookingRoutes);
app.use("/auth", authRoutes);

app.use("/agencies/me/staff", staffRoutes);



// Liveness probe consumed by Prometheus / the load balancer.
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
  connectMongo().catch(console.error);
  startSubscriptionCron();
  // Ensure Meilisearch indexes + settings exist on boot (idempotent, non-blocking).
  configureIndexes().catch(console.error);


  app.listen(port, () => {
    console.log(`Funtush API listening on port ${port}`);
  });
}

export { app };