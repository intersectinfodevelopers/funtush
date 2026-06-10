import express from "express";
import { resolveTenant }       from "./middleware/resolveTenant.middleware";
import { rateLimitMiddleware }  from "./middleware/rateLimit.middleware";
import { requestLogger }        from "./middleware/requestLogger.middleware";
import adminRouter              from "./routes/admin/index";
import agencyRoutes             from "./routes/agency.routes";
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";

const app = express();

app.use(express.json());
app.use(requestLogger);

// Health check BEFORE tenant middleware so it always works
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/sos", (_req, res) => {
  res.json({ status: "SOS received" });
});

app.use(resolveTenant);
app.use(rateLimitMiddleware);
app.use("/admin", adminRouter);
app.use("/", agencyRoutes);

app.use(express.json());
app.use(requestLogger);
app.use(resolveTenant);
app.use(rateLimitMiddleware);

app.use("/admin", adminRouter);
app.use("/", agencyRoutes);

app.post("/sos", (_req, res) => {
  res.json({ status: "SOS received" });
});

app.get("/health", (req, res) => {
  res.json({
    status:   "ok",
    tenantId: req.tenantId,
    agencyId: req.agencyId,
    context:  req.context,
  });
});

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  startSubscriptionCron();
}

export default app;