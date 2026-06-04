import express from "express";
import { resolveTenant } from "./middleware/resolveTenant.middleware";
import adminRouter from "./routes/admin/index";

const app = express();

app.use(express.json());

// 1. Resolve tenant context on every request FIRST
app.use(resolveTenant);

// 2. Mount admin routes (internally guarded by requireAdmin)
app.use("/admin", adminRouter);

// 3. Health check — useful to verify tenant resolution is wired
app.get("/health", (req, res) => {
  res.json({
    status:   "ok",
    tenantId: req.tenantId,
    agencyId: req.agencyId,
    context:  req.context,
  });
});

export default app;
