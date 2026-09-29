import type { Request, Response, NextFunction } from "express";

const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT_REQUESTS ?? 400);
const HANDLER_TIMEOUT_MS = Number(process.env.REQUEST_HANDLER_TIMEOUT_MS ?? 30_000);

// A probe or a scrape must still get through when the API is saturated —
// that's exactly when they matter.
const EXEMPT = new Set(["/health", "/metrics"]);

let inFlight = 0;
export const currentInFlight = (): number => inFlight;

/**
 * Overload protection. Without it, a traffic spike (or a few slow queries)
 * lets requests pile up unboundedly: each one holds memory and a pool
 * connection, latency for *everyone* climbs, and eventually the process is
 * OOM-killed or the database pool is starved — a crash. Refusing the excess
 * fast with 503 + Retry-After keeps the requests already in flight healthy
 * and lets clients/load balancers back off.
 *
 * Also caps how long any single handler may keep a client waiting: after
 * REQUEST_HANDLER_TIMEOUT_MS the client gets a 503 rather than a hung socket.
 */
export function loadShedding(req: Request, res: Response, next: NextFunction): void {
  if (EXEMPT.has(req.path)) {
    next();
    return;
  }

  if (inFlight >= MAX_INFLIGHT) {
    res.setHeader("Retry-After", "2");
    res.status(503).json({ message: "Server is busy, please retry shortly" });
    return;
  }

  inFlight++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight--;
    clearTimeout(timer);
  };

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ message: "Request timed out" });
    }
    release();
  }, HANDLER_TIMEOUT_MS);
  timer.unref();

  res.on("finish", release);
  res.on("close", release);
  next();
}
