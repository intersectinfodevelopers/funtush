import { Router, Request, Response, NextFunction } from 'express';
import prometheus from 'prom-client';
import { timingSafeEqual } from 'crypto';
import cluster from 'cluster';

/**
 * Prometheus Metrics Service
 * Tracks: Request rate, latency, error rate per endpoint
 */

// Create registry
const register = new prometheus.Registry();

// When the API runs as several worker processes (see src/cluster.ts) each worker
// counts only its own requests. Constructing an AggregatorRegistry makes this
// process answer the primary's "give me your metrics" requests (workers), and
// pointing it at OUR registry (not prom-client's global one) is what makes those
// answers include the counters defined below.
new prometheus.AggregatorRegistry();
prometheus.AggregatorRegistry.setRegistries([register]);

// Default metrics (CPU, memory, etc)
prometheus.collectDefaultMetrics({ register });

// CUSTOM METRICS

// 1. Request Counter - total requests per endpoint
const httpRequestsTotal = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// 2. Request Duration Histogram - latency per endpoint
const httpRequestDurationSeconds = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// 3. Error Rate Counter
const httpRequestsError = new prometheus.Counter({
  name: 'http_requests_error_total',
  help: 'Total HTTP request errors',
  labelNames: ['method', 'route', 'error_type'],
  registers: [register],
});

// 4. Database Metrics
const dbConnectionPoolSize = new prometheus.Gauge({
  name: 'db_connection_pool_size',
  help: 'Database connection pool size',
  labelNames: ['pool_name'],
  registers: [register],
});

const dbConnectionPoolUsed = new prometheus.Gauge({
  name: 'db_connection_pool_used',
  help: 'Database connections in use',
  labelNames: ['pool_name'],
  registers: [register],
});

const dbQueryDurationSeconds = new prometheus.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query latency',
  labelNames: ['query_type', 'table'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

// 5. Redis Metrics
const redisHitRate = new prometheus.Counter({
  name: 'redis_hits_total',
  help: 'Redis cache hits',
  labelNames: ['cache_key'],
  registers: [register],
});

const redisMissRate = new prometheus.Counter({
  name: 'redis_misses_total',
  help: 'Redis cache misses',
  labelNames: ['cache_key'],
  registers: [register],
});

const redisOperationDurationSeconds = new prometheus.Histogram({
  name: 'redis_operation_duration_seconds',
  help: 'Redis operation latency',
  labelNames: ['operation'],
  buckets: [0.001, 0.01, 0.05, 0.1],
  registers: [register],
});

// 6. GPS Pipeline Metrics
const gpsPipelineThroughput = new prometheus.Counter({
  name: 'gps_pipeline_throughput_total',
  help: 'GPS pipeline throughput (locations processed)',
  labelNames: ['pipeline_stage'],
  registers: [register],
});

const gpsPipelineLatency = new prometheus.Histogram({
  name: 'gps_pipeline_latency_seconds',
  help: 'GPS pipeline latency',
  labelNames: ['pipeline_stage'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// 7. SOS Metrics
const sosRequestsTotal = new prometheus.Counter({
  name: 'sos_requests_total',
  help: 'Total SOS requests',
  labelNames: ['status'],
  registers: [register],
});

const sosResponseTime = new prometheus.Histogram({
  name: 'sos_response_time_seconds',
  help: 'SOS response time',
  labelNames: ['tier'],
  buckets: [5, 10, 15, 30, 60],
  registers: [register],
});

const sosUnacknowledged = new prometheus.Gauge({
  name: 'sos_unacknowledged_total',
  help: 'Total unacknowledged SOS requests',
  registers: [register],
});

// 8. Payment Gateway Metrics
const paymentGatewayRequests = new prometheus.Counter({
  name: 'payment_gateway_requests_total',
  help: 'Payment gateway requests',
  labelNames: ['gateway', 'status'],
  registers: [register],
});

const paymentGatewayLatency = new prometheus.Histogram({
  name: 'payment_gateway_latency_seconds',
  help: 'Payment gateway latency',
  labelNames: ['gateway'],
  buckets: [0.5, 1, 2, 5, 10],
  registers: [register],
});

const paymentGatewayErrors = new prometheus.Counter({
  name: 'payment_gateway_errors_total',
  help: 'Payment gateway errors',
  labelNames: ['gateway', 'error_type'],
  registers: [register],
});

// 9. Business Metrics
const activeUsers = new prometheus.Gauge({
  name: 'active_users_total',
  help: 'Total active users',
  registers: [register],
});

const bookingsTotal = new prometheus.Counter({
  name: 'bookings_total',
  help: 'Total bookings',
  labelNames: ['status'],
  registers: [register],
});

const revenueTotal = new prometheus.Counter({
  name: 'revenue_total',
  help: 'Total revenue',
  labelNames: ['currency'],
  registers: [register],
});

/** Count one booking landing in `status` (created there, or transitioned into it). */
const trackBooking = (status: string): void => {
  bookingsTotal.labels(status).inc();
};

/** One inbound payment-gateway callback and how it ended (success / invalid signature / processing error). */
const recordPaymentGateway = (gateway: string, outcome: 'success' | 'invalid' | 'error', startedAtMs?: number): void => {
  paymentGatewayRequests.labels(gateway, outcome).inc();
  if (outcome !== 'success') paymentGatewayErrors.labels(gateway, outcome).inc();
  if (startedAtMs !== undefined) paymentGatewayLatency.labels(gateway).observe((Date.now() - startedAtMs) / 1000);
};

/** Money that actually settled (call once, at the commit point — never on a retried webhook). */
const recordRevenue = (currency: string, amount: number): void => {
  if (Number.isFinite(amount) && amount > 0) revenueTotal.labels(currency).inc(amount);
};

/** An SOS was raised (`triggered`) or dismissed (`cancelled`). */
const recordSos = (status: 'triggered' | 'cancelled' | 'failed'): void => {
  sosRequestsTotal.labels(status).inc();
};

// Middleware to track HTTP metrics. Mounted globally (before routing), so
// `req.route` isn't set yet when this function body runs — reading it here
// would always fall back to `req.path`, the *raw* URL (`/admin/agencies/<uuid>`
// instead of `/admin/agencies/:id`), which explodes Prometheus label
// cardinality (a distinct time series per id, forever). Express populates
// `req.route`/`req.baseUrl` by the time the response is sent, though — so
// the label is read in a `res.on("finish")` handler instead, after routing
// has actually happened.
//
// finish, not a `res.send` override: an unmatched route (no handler ever
// calls res.send/.json) is answered by Express's internal `finalhandler`,
// which writes the 404 directly without going through `res.send` at all —
// wrapping `send` would silently miss every genuine 404. `finish` fires for
// every response regardless of how it was written (this is the same
// pattern impersonationAudit.middleware.ts uses, for the same reason).
const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000;
    // `.labels()` requires string values — passing the raw number (as this
    // did before) throws at the first request that hits this middleware.
    const statusCode = String(res.statusCode || 500);
    // A matched request is labelled by its route *pattern*. An unmatched one
    // (404) has no pattern, and falling back to the raw path would let anyone
    // mint unlimited time series just by requesting /a1, /a2, /a3… — an
    // unauthenticated memory-growth vector — so they share one bucket.
    const route = req.route ? (req.baseUrl || "") + req.route.path : "unmatched";

    httpRequestsTotal.labels(req.method, route, statusCode).inc();
    httpRequestDurationSeconds.labels(req.method, route, statusCode).observe(duration);

    if (res.statusCode >= 400) {
      httpRequestsError.labels(req.method, route, 'http_error').inc();
    }
  });

  next();
};

/**
 * The text a scrape should return. Single process: this process's registry.
 * Cluster worker: the scrape landed on one arbitrary worker, but Prometheus
 * needs the *whole service*, so ask the primary to aggregate every worker's
 * counters (it does, in src/cluster.ts). Falls back to local-only metrics if
 * the primary doesn't answer, so a scrape never hangs.
 */
let metricsReqId = 0;
const pendingMetrics = new Map<number, (text: string | null) => void>();
if (cluster.isWorker) {
  process.on('message', (msg: { type?: string; id?: number; text?: string; error?: string }) => {
    if (msg?.type !== 'funtush:metrics-res' || msg.id === undefined) return;
    pendingMetrics.get(msg.id)?.(msg.error ? null : (msg.text ?? null));
  });
}

async function getMetricsText(): Promise<string> {
  if (!cluster.isWorker || !process.send) return register.metrics();

  const id = metricsReqId++;
  const aggregated = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => { pendingMetrics.delete(id); resolve(null); }, 3000);
    pendingMetrics.set(id, (text) => { clearTimeout(timer); pendingMetrics.delete(id); resolve(text); });
    process.send!({ type: 'funtush:metrics-req', id });
  });
  return aggregated ?? register.metrics();
}

// Export metrics endpoint. Deliberately just `/metrics` — no duplicate
// `/health` here, since app.ts already has a real one that checks live
// Postgres/Redis connectivity; this file's version would only have reported
// process uptime, silently shadowing or being shadowed depending on mount
// order.
const metricsRouter = Router();

// Scrape access. Route names, error rates and business counters are
// reconnaissance data, so this isn't left world-readable in production:
//   - METRICS_TOKEN set  -> requires `Authorization: Bearer <token>` (Prometheus
//     `authorization: credentials:` / `bearer_token` scrape config)
//   - unset, production  -> 404, as if the route didn't exist (fail closed)
//   - unset, elsewhere   -> open, for local dev
const tokensMatch = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

metricsRouter.get('/metrics', async (req: Request, res: Response) => {
  const expected = process.env.METRICS_TOKEN;
  if (expected) {
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!tokensMatch(given, expected)) {
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Metrics token required' });
      return;
    }
  } else if (process.env.NODE_ENV === 'production') {
    res.status(404).end();
    return;
  }
  res.set('Content-Type', register.contentType);
  res.end(await getMetricsText());
});

export {
  metricsRouter,
  metricsMiddleware,
  register,
  // Counters
  httpRequestsTotal,
  httpRequestsError,
  redisHitRate,
  redisMissRate,
  gpsPipelineThroughput,
  sosRequestsTotal,
  paymentGatewayRequests,
  paymentGatewayErrors,
  bookingsTotal,
  trackBooking,
  recordPaymentGateway,
  recordRevenue,
  recordSos,
  revenueTotal,
  // Histograms
  httpRequestDurationSeconds,
  dbQueryDurationSeconds,
  redisOperationDurationSeconds,
  gpsPipelineLatency,
  sosResponseTime,
  paymentGatewayLatency,
  // Gauges
  dbConnectionPoolSize,
  dbConnectionPoolUsed,
  sosUnacknowledged,
  activeUsers,
};