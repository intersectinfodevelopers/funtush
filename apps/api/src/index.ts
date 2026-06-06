import express, { type Request, type Response } from "express";
import { db, redis } from "@funtush/database";


import agencyRoutes from './routes/agency.routes';
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";

const app = express();

app.use(express.json());

app.use('/', agencyRoutes);


// Liveness probe consumed by Prometheus / the load balancer.
app.get("/health", async (_req: Request, res: Response) => {
  const [dbOk, redisOk] = await Promise.all([
    db.query("SELECT 1").then(() => true).catch(() => false),
    redis.ping().then((r) => r === "PONG").catch(() => false),
  ]);

  const ok = dbOk && redisOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "error",
    db: dbOk ? "ok" : "error",
    redis: redisOk ? "ok" : "error",
  });
});

// Side effects (server + cron) are skipped under test so the `app` export can be
// imported and exercised in isolation without binding a port or scheduling jobs.
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  const port = Number(process.env.PORT ?? 4000);

  // For cron job
  startSubscriptionCron();

  app.listen(port, () => {
    console.log(`Funtush API listening on port ${port}`);
  });
}


export { app };
