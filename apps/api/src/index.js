import express from "express";
import { resolveTenant } from "./middleware/resolveTenant.middleware.js";

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

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});