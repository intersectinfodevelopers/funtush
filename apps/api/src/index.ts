<<<<<<< HEAD
import app from "./app";

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, () => {
  console.log(`[server] Running on port ${PORT}`);
});
=======
<<<<<<< HEAD:apps/api/src/index.ts
import express, { type Request, type Response } from "express";

import agencyRoutes from './routes/agency.routes';
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";
=======
import express from "express";
import { resolveTenant } from "./middleware/resolveTenant.middleware.js";
>>>>>>> dfc14b2 (feat: implement resolveTenant middleware with Redis caching):apps/api/src/index.js

const app = express();

app.use(express.json());
app.use(resolveTenant);

<<<<<<< HEAD:apps/api/src/index.ts
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
=======
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    tenantId: req.tenantId,
    agencyId: req.agencyId,
    context: req.context,   // ← "platform" | "agency" | "admin"
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
>>>>>>> dfc14b2 (feat: implement resolveTenant middleware with Redis caching):apps/api/src/index.js
>>>>>>> ed8e877
