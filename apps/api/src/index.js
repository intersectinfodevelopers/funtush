import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(express.json());

// Liveness probe consumed by Prometheus / the load balancer.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "funtush-api" });
});

app.listen(port, () => {
  console.log(`Funtush API listening on port ${port}`);
});


export { app };
