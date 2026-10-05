// Gentle, read-only load test for the Funtush API. See tests/load/README.md.
//
//   TARGET=http://localhost:4100 node tests/load/loadtest.mjs            # local API
//   TARGET=https://develop.shirijanga.com node tests/load/loadtest.mjs   # staging
//
// Safety: GET-only (+1 login), bounded duration, aborts if the server degrades,
// and respects the API's own rate limiter (it never tries to bypass it).
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execP = promisify(exec);

const B = (process.env.TARGET || "").replace(/\/$/, "");
if (!B) {
  console.error("Set TARGET, e.g. TARGET=http://localhost:4100 node tests/load/loadtest.mjs (see tests/load/README.md)");
  process.exit(2);
}
// Local runs reset the rate-limit counters in the local test Redis instead of waiting,
// and add a capacity phase that the limiter would otherwise make impossible.
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(B);
const REDIS_CONTAINER = process.env.REDIS_CONTAINER || "api-redis-1";
// Optional: an SSH host alias for a remote target, to sample its load/CPU between phases.
const SSH_HOST = process.env.SSH_HOST || "";
const QA_EMAIL = process.env.QA_EMAIL || "agency@funtush.com";
const QA_PASSWORD = process.env.QA_PASSWORD || "Test@123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : NaN);
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(0).padStart(5) : "  n/a");

async function hit(path, headers = {}) {
  const t = performance.now();
  try {
    const r = await fetch(B + path, { headers, signal: AbortSignal.timeout(20000) });
    await r.arrayBuffer();
    return { path, status: r.status, ms: performance.now() - t, reset: Number(r.headers.get("x-ratelimit-reset")) || 0, remaining: r.headers.get("x-ratelimit-remaining") };
  } catch (e) {
    return { path, status: 0, ms: performance.now() - t, err: e.name === "TimeoutError" ? "timeout" : (e.cause?.code || e.message) };
  }
}

async function flushLimiter() {
  await execP(`docker exec ${REDIS_CONTAINER} sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del >/dev/null"`);
}

async function server(label) {
  if (!LOCAL) return SSH_HOST ? serverRemote(label) : undefined;
  try {
    const { stdout } = await execP(
      `P=$(pgrep -d, -f "src/cluster.ts"); echo "load: $(cut -d' ' -f1-3 /proc/loadavg)"; top -b -n2 -d1 -p $P | awk '/^top/{n++} n==2 && $1 ~ /^[0-9]+$/ {cpu+=$9; rss+=$6; c++} END{printf "api procs=%d cpu=%.0f%% rss=%.0fMB", c, cpu, rss/1024}'`,
      { timeout: 20000 },
    );
    console.log(`   [local ${label}] ${stdout.trim().split("\n").join(" | ")}`);
  } catch { console.log(`   [local ${label}] (sample failed)`); }
}

function report(name, results, seconds) {
  const by = {};
  for (const r of results) (by[r.status] ||= []).push(r);
  const ok = (by[200] || []).map((r) => r.ms).sort((a, b) => a - b);
  const lim = (by[429] || []).map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\n== ${name}: ${results.length} requests in ${seconds.toFixed(1)}s (${(results.length / seconds).toFixed(1)} req/s)`);
  console.log("   status counts:", Object.entries(by).map(([s, v]) => `${s}=${v.length}`).join("  "));
  if (ok.length) console.log(`   200 latency ms  p50=${fmt(pct(ok, 50))} p95=${fmt(pct(ok, 95))} p99=${fmt(pct(ok, 99))} max=${fmt(ok.at(-1))}`);
  if (lim.length) console.log(`   429 latency ms  p50=${fmt(pct(lim, 50))} p95=${fmt(pct(lim, 95))} max=${fmt(lim.at(-1))}  (rate limiter rejecting — expected past 200/min)`);
  const errs = (by[0] || []).reduce((m, r) => ((m[r.err] = (m[r.err] || 0) + 1), m), {});
  if (Object.keys(errs).length) console.log("   network errors:", JSON.stringify(errs));
  const s5 = Object.entries(by).filter(([s]) => +s >= 500).map(([s, v]) => `${s}=${v.length}`);
  if (s5.length) console.log("   SERVER ERRORS:", s5.join(" "));
  return { ok, lim, by };
}

async function serverRemote(label) {
  try {
    const { stdout } = await execP(
      `ssh -o BatchMode=yes -o ConnectTimeout=10 ${SSH_HOST} 'echo "load: $(cut -d" " -f1-3 /proc/loadavg)"; docker stats --no-stream --format "{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}" funtush-api funtush-postgres funtush-redis'`,
      { timeout: 30000 },
    );
    console.log(`   [server ${label}] ${stdout.trim().split("\n").join(" | ")}`);
  } catch { console.log(`   [server ${label}] (sample failed)`); }
}

const degraded = (recent) => recent.length >= 30 && recent.slice(-30).filter((r) => r.status === 0 || r.status >= 500).length > 9;

// ---------- login once (counts 1 of the 5/min login budget) ----------
const login = await (await fetch(B + "/auth/agency/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD }) })).json();
const tok = login.data || login;
const AUTH = { "x-refresh-token": tok.refreshToken };

const PUBLIC = ["/health", "/marketplace/packages", "/marketplace/agencies", "/marketplace/stats", "/marketplace/featured", "/subscription-tiers", "/docs.json"];
const AUTHED = ["/agencies/me/dashboard", "/agencies/me/finance/pnl"];
const MIX = [...PUBLIC, ...PUBLIC, ...AUTHED]; // ~78% public, ~22% authenticated agency reads
const pick = () => { const p = MIX[Math.floor(Math.random() * MIX.length)]; return [p, p.startsWith("/agencies") ? AUTH : {}]; };

async function waitForWindow(label) {
  if (LOCAL) { await flushLimiter(); console.log(`\n-- (local) rate-limit counters reset (${label})`); return; }
  const r = await hit("/health");
  const wait = (r.reset || 60) + 2;
  console.log(`\n-- waiting ${wait}s for the rate-limit window to reset (${label})`);
  await sleep(wait * 1000);
}

console.log("Target:", B, LOCAL ? "(local)" : "(remote)", "| started", new Date().toISOString());
await server("before");

// ---------- Phase 0: baseline (sequential) ----------
console.log("\n#### PHASE 0 — baseline, sequential (5 requests per endpoint)");
for (const p of [...PUBLIC, ...AUTHED]) {
  const rs = [];
  for (let i = 0; i < 5; i++) rs.push(await hit(p, p.startsWith("/agencies") ? AUTH : {}));
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`   ${p.padEnd(28)} status=${[...new Set(rs.map((r) => r.status))].join(",")}  p50=${fmt(pct(ms, 50))}ms  max=${fmt(ms.at(-1))}ms`);
}

// ---------- Phase 1: realistic sustained load, under the limiter ----------
await waitForWindow("phase 1");
console.log("\n#### PHASE 1 — sustained 3 req/s for 60s (180 req, under the 200/min limit), mixed public + agency-authenticated");
{
  const results = [], inflight = new Set(); const t0 = performance.now(); let stop = false;
  const timer = setInterval(() => {
    if (stop) return;
    const [p, h] = pick(); const pr = hit(p, h).then((r) => { results.push(r); inflight.delete(pr); }); inflight.add(pr);
    if (degraded(results)) { stop = true; console.log("   !! ABORT: server degrading"); }
  }, 1000 / 3);
  setTimeout(() => server("mid phase 1"), 30000);
  await sleep(60000); stop = true; clearInterval(timer); await Promise.all(inflight);
  report("PHASE 1", results, (performance.now() - t0) / 1000);
}
await server("after phase 1");

// ---------- Phase 2: burst beyond the limiter (closed loop) ----------
await waitForWindow("phase 2");
console.log("\n#### PHASE 2 — burst: 20 concurrent connections for 15s on ONE path (/marketplace/packages — hits the DB; exceeds the 200/min per-path limit)");
{
  const results = []; const t0 = performance.now(); let stop = false;
  const worker = async () => { while (!stop && performance.now() - t0 < 15000) { results.push(await hit("/marketplace/packages")); if (degraded(results)) { stop = true; console.log("   !! ABORT: server degrading"); } } };
  setTimeout(() => server("mid burst"), 6000);
  await Promise.all(Array.from({ length: 20 }, worker));
  const { by } = report("PHASE 2", results, (performance.now() - t0) / 1000);
  const first429 = results.findIndex((r) => r.status === 429);
  console.log(`   first 429 after ${first429 < 0 ? "never" : first429 + " requests"} (limiter allows 200/min/IP)`);
  const served = (by[200] || []).length; console.log(`   total served 200: ${served}`);
}
await server("right after burst");

// ---------- Phase 3 (LOCAL ONLY): capacity within the limiter ----------
if (LOCAL) {
  console.log("\n#### PHASE 3 (local only) — capacity: 190 requests per path at fixed concurrency (counters reset before each run, so the limiter never trips)");
  for (const conc of [10, 50]) {
    for (const p of ["/health", "/marketplace/packages", "/marketplace/agencies", "/subscription-tiers", "/agencies/me/dashboard"]) {
      await flushLimiter();
      const results = []; let n = 0; const t0 = performance.now();
      const h = p.startsWith("/agencies") ? AUTH : {};
      await Promise.all(Array.from({ length: conc }, async () => { while (n < 190) { n++; results.push(await hit(p, h)); } }));
      const sec = (performance.now() - t0) / 1000; const ms = results.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
      const bad = results.filter((r) => r.status !== 200).length;
      console.log(`   c=${String(conc).padEnd(3)} ${p.padEnd(26)} ${(results.length / sec).toFixed(0).padStart(5)} req/s  p50=${fmt(pct(ms, 50))}ms p95=${fmt(pct(ms, 95))}ms p99=${fmt(pct(ms, 99))}ms max=${fmt(ms.at(-1))}ms  non-200=${bad}`);
    }
    await server(`after capacity c=${conc}`);
  }
}

// ---------- Recovery ----------
await waitForWindow("recovery check");
const rec = [];
for (let i = 0; i < 10; i++) rec.push(await hit("/health"));
console.log("\n== RECOVERY after burst: /health x10 →", [...new Set(rec.map((r) => r.status))].join(","), "p50=" + fmt(pct(rec.map((r) => r.ms).sort((a, b) => a - b), 50)) + "ms");
await server("final");
console.log("\nDone", new Date().toISOString());
