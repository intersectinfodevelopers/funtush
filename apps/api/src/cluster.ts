/**
 * Multi-process entrypoint: `pnpm start` → this file.
 *
 * One Node process executes JavaScript on one core, so a single API instance
 * can never use more than 1/N of an N-core machine. This forks WEB_CONCURRENCY
 * workers (default: one per CPU); each runs the normal server (`./index`) and
 * the OS load-balances incoming connections across them (round-robin).
 *
 * The primary does no request work. It supervises:
 *  - a worker that dies is replaced (with exponential backoff if it is
 *    crash-looping, so a broken deploy can't spin the CPU)
 *  - SIGTERM/SIGINT drain every worker, then exit (forced after 20s)
 *  - SIGUSR2 is a zero-downtime rolling restart: start a replacement, wait
 *    until it is listening, then retire the old worker, one at a time
 *  - /metrics: a scrape lands on one arbitrary worker but must describe the
 *    whole service, so workers ask the primary, which sums every worker's
 *    counters (prom-client's AggregatorRegistry).
 *
 * Cron jobs are safe with N processes: each tick is claimed with a Redis lock
 * (jobs/jobLock.ts), so exactly one process runs it.
 *
 * Total DB connections = connection_limit × WEB_CONCURRENCY — keep that below
 * Postgres max_connections (or put PgBouncer in front).
 */
import "dotenv/config"; // load .env BEFORE the config guard reads process.env (workers do the same via ./index)
import cluster, { type Worker } from "node:cluster";
import os from "node:os";
import { AggregatorRegistry } from "prom-client";
import { assertSecureConfig } from "./lib/assertSecureConfig";

if (cluster.isPrimary) {
  // Fail once, loudly, in the primary — not as N workers crash-looping.
  assertSecureConfig();
  const requested = Number(process.env.WEB_CONCURRENCY);
  const workerCount = Math.min(64, Math.max(1, Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : os.availableParallelism()));
  const DRAIN_TIMEOUT_MS = 20_000;

  const aggregator = new AggregatorRegistry();
  let shuttingDown = false;
  let rolling = false;
  const startedAt = new Map<number, number>();
  let recentCrashes = 0;

  const spawn = (): Worker => {
    const worker = cluster.fork();
    startedAt.set(worker.id, Date.now());
    return worker;
  };

  console.log(`[cluster] primary ${process.pid} starting ${workerCount} worker(s)`);
  for (let i = 0; i < workerCount; i++) spawn();

  cluster.on("exit", (worker, code, signal) => {
    const lived = Date.now() - (startedAt.get(worker.id) ?? Date.now());
    startedAt.delete(worker.id);
    if (shuttingDown) return;
    // a worker we retired on purpose during a rolling restart is already replaced
    if ((worker as Worker & { retired?: boolean }).retired) return;

    console.error(`[cluster] worker ${worker.process.pid} exited (code=${code}, signal=${signal}) after ${lived}ms — replacing`);
    // Crash-loop protection: workers that die young back off exponentially (1s → 30s).
    recentCrashes = lived < 10_000 ? recentCrashes + 1 : 0;
    const delay = recentCrashes === 0 ? 0 : Math.min(30_000, 1000 * 2 ** (recentCrashes - 1));
    setTimeout(() => { if (!shuttingDown) spawn(); }, delay);
  });

  // Metrics bridge: a worker asks, we aggregate across all workers and reply.
  cluster.on("message", (worker, msg: { type?: string; id?: number }) => {
    if (msg?.type !== "funtush:metrics-req") return;
    aggregator
      .clusterMetrics()
      .then((text) => worker.send({ type: "funtush:metrics-res", id: msg.id, text }))
      .catch((err: Error) => worker.send({ type: "funtush:metrics-res", id: msg.id, error: err.message }));
  });

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cluster] ${signal} — draining ${Object.keys(cluster.workers ?? {}).length} worker(s)`);
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill("SIGTERM");

    const force = setTimeout(() => {
      console.error("[cluster] drain timed out — killing workers");
      for (const w of Object.values(cluster.workers ?? {})) w?.process.kill("SIGKILL");
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);
    force.unref();

    const check = setInterval(() => {
      if (Object.keys(cluster.workers ?? {}).length === 0) { clearInterval(check); process.exit(0); }
    }, 100);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Zero-downtime restart (deploys): replace workers one at a time, never dropping below N serving.
  process.on("SIGUSR2", async () => {
    if (rolling || shuttingDown) return;
    rolling = true;
    console.log("[cluster] SIGUSR2 — rolling restart");
    for (const old of Object.values(cluster.workers ?? {})) {
      if (!old || shuttingDown) break;
      const replacement = spawn();
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 30_000); // don't hang the roll on a worker that never listens
        replacement.once("listening", () => { clearTimeout(t); resolve(); });
      });
      (old as Worker & { retired?: boolean }).retired = true;
      old.process.kill("SIGTERM");
      await new Promise<void>((resolve) => { old.once("exit", () => resolve()); setTimeout(resolve, DRAIN_TIMEOUT_MS).unref(); });
    }
    rolling = false;
    console.log("[cluster] rolling restart complete");
  });
} else {
  // A worker is just the ordinary server.
  void import("./index");
}
