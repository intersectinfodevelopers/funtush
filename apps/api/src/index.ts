import express, { type Request, type Response } from "express";

import agencyRoutes from './routes/agency.routes';
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(express.json());

//For cron job
startSubscriptionCron();

app.use('/', agencyRoutes);


// Liveness probe consumed by Prometheus / the load balancer.
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "funtush-api" });
});

app.listen(port, () => {
  console.log(`Funtush API listening on port ${port}`);
});


export { app };
