// ─────────────────────────────────────────────────────────────────────────────
// Multi-process cluster (src/cluster.ts) — boots the REAL entrypoint as a child
// process against the docker-compose.test.yml infra and checks what a
// deployment relies on: N workers serve, /metrics sums across workers, a killed
// worker is replaced with no outage, and SIGTERM drains and exits cleanly.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { dbAvailable } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

const PORT = 4187;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// tsx runs an esbuild helper as a child of the primary, so filter to real node processes
const workerPids = (parent: number): number[] => {
  try {
    return execSync(`ps -o pid=,args= --ppid ${parent}`)
      .toString()
      .split("\n")
      .filter((l) => l.trim() && !/esbuild/.test(l))
      .map((l) => Number(l.trim().split(/\s+/)[0]));
  } catch {
    return [];
  }
};

// tsx spawns a wrapper process, so the real primary is the deepest node that has the workers
const findPrimary = (root: number): { primary: number; workers: number[] } => {
  let cur = root;
  for (let depth = 0; depth < 4; depth++) {
    const kids = workerPids(cur);
    if (kids.length >= 2) return { primary: cur, workers: kids };
    if (kids.length === 0) break;
    cur = kids[0];
  }
  return { primary: cur, workers: workerPids(cur) };
};

async function waitHealthy(timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  return false;
}

d("cluster entrypoint (e2e)", () => {
  let child: ChildProcess;
  let exitCode: number | null | undefined;
  let exited = false;

  beforeAll(async () => {
    if (!RUN) return;
    const env = { ...process.env, PORT: String(PORT), WEB_CONCURRENCY: "2", NODE_ENV: "development" } as Record<string, string | undefined>;
    delete env.VITEST; // index.ts refuses to listen under vitest
    delete env.METRICS_TOKEN;
    child = spawn("npx", ["tsx", "src/cluster.ts"], { env, stdio: "ignore" });
    child.on("exit", (code) => { exited = true; exitCode = code; });
    expect(await waitHealthy(60_000)).toBe(true);
  }, 90_000);

  afterAll(async () => {
    if (child && !exited) {
      const { primary } = findPrimary(child.pid!);
      try { process.kill(primary, "SIGKILL"); } catch { /* gone */ }
      child.kill("SIGKILL");
    }
  });

  it("runs the requested number of workers under one primary", async () => {
    const { workers } = findPrimary(child.pid!);
    expect(workers.length).toBe(2);
  });

  it("aggregates /metrics across workers (a scrape sees every worker's requests)", async () => {
    const N = 60;
    for (let i = 0; i < N; i++) {
      // distinct client per request so the per-IP rate limiter never interferes
      await fetch(`${base}/marketplace/agencies`, { headers: { "x-forwarded-for": `10.9.${Math.floor(i / 250)}.${i % 250}` } });
    }
    const text = await (await fetch(`${base}/metrics`)).text();
    const line = text.split("\n").find((l) => l.startsWith("http_requests_total{") && l.includes('route="/marketplace/agencies"') && l.includes('status_code="200"'));
    expect(line, "aggregated counter present").toBeTruthy();
    // if only ONE worker's registry answered, this would be roughly N/2, not N
    expect(Number(line!.split(" ").pop())).toBeGreaterThanOrEqual(N);
  });

  it("replaces a killed worker and keeps serving throughout", async () => {
    const { primary, workers } = findPrimary(child.pid!);
    const victim = workers[0];
    process.kill(victim, "SIGKILL");

    // Not an outage: the surviving worker keeps answering while the replacement
    // boots. A request already routed to the just-SIGKILLed worker can reset (a
    // reverse proxy retries those on another connection), so allow a couple of
    // losses but require the service to be continuously reachable.
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      try { if ((await fetch(`${base}/health`)).status === 200) ok++; } catch { /* raced the dead worker */ }
      await sleep(100);
    }
    expect(ok).toBeGreaterThanOrEqual(17);

    const until = Date.now() + 30_000;
    let now: number[] = [];
    while (Date.now() < until) {
      now = workerPids(primary);
      if (now.length === 2 && !now.includes(victim)) break;
      await sleep(300);
    }
    expect(now.length).toBe(2);
    expect(now).not.toContain(victim);
    expect(await waitHealthy(20_000)).toBe(true);
  }, 60_000);

  it("drains and exits 0 on SIGTERM", async () => {
    const { primary } = findPrimary(child.pid!);
    process.kill(primary, "SIGTERM");
    const until = Date.now() + 25_000;
    while (!exited && Date.now() < until) await sleep(200);
    expect(exited).toBe(true);
    // tsx forwards the signal; a clean drain is 0 (or the wrapper's 143 for SIGTERM)
    expect([0, 143, null]).toContain(exitCode);
    await expect(fetch(`${base}/health`)).rejects.toThrow();
  }, 40_000);
});
