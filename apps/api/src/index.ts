
import express, { type Request, type Response, type NextFunction } from "express";
import { MulterError } from "multer";
import uploadRoutes from "./routes/upload.routes";

import agencyRoutes from './routes/agency.routes';
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(express.json());

//For cron job
startSubscriptionCron();




// Routes
app.use("/", uploadRoutes);
app.use('/', agencyRoutes);


// Liveness probe consumed by Prometheus / the load balancer.
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "funtush-api" });
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

app.listen(port, () => {
  console.log(`Funtush API listening on port ${port}`);
});

export { app };
