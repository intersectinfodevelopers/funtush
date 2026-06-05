import express from "express";
import { resolveTenant }      from "./middleware/resolveTenant.middleware";
import { rateLimitMiddleware } from "./middleware/rateLimit.middleware";
import { requestLogger }       from "./middleware/requestLogger.middleware";
import adminRouter             from "./routes/admin/index";

const app = express();

app.use(express.json());


app.use(requestLogger);

app.use(resolveTenant);

app.use(rateLimitMiddleware);

app.use("/admin", adminRouter);

app.get("/health", (req, res) => {
  res.json({
    status:   "ok",
    tenantId: req.tenantId,
    agencyId: req.agencyId,
    context:  req.context,
  });
});


app.post("/sos", (req, res) => {
  res.json({ status: "SOS received", message: "Emergency services notified" });
});

export default app;
