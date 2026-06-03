import express from "express";
import { resolveTenant } from "./middleware/resolveTenant.middleware";

const app = express();

app.use(express.json());

app.use(resolveTenant);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    tenantId: req.tenantId,
    agencyId: req.agencyId,
    context: req.context, 
  });
});

export default app;