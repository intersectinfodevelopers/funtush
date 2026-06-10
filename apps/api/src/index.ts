import express, { type Request, type Response, type NextFunction } from "express";
import { MulterError } from "multer";
import { db, redis } from "@funtush/database";
import uploadRoutes from "./routes/upload.routes";

import agencyRoutes from './routes/agency.routes';
import adminRoutes from './routes/admin.routes';
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";

const app = express();
// app.use(express.json())
const port = Number(process.env.PORT ?? 4000);

app.use(express.json());
app.use("/", uploadRoutes);
app.use('/', agencyRoutes);
app.use('/', adminRoutes);


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
  startSubscriptionCron();

  app.listen(port, () => {
    console.log(`Funtush API listening on port ${port}`);
  });
}

export { app };
