import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

async function appWith(env: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, env);
  const { loadShedding, currentInFlight } = await import("./loadShedding.middleware");
  const app = express();
  app.use(loadShedding);
  let release: (() => void) | undefined;
  app.get("/slow", (_req, res) => { release = () => res.json({ ok: true }); });
  app.get("/fast", (_req, res) => res.json({ ok: true }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  return { app, currentInFlight, finishSlow: () => release?.() };
}

describe("loadShedding", () => {
  it("sheds excess concurrent requests with 503 + Retry-After, but always lets /health through", async () => {
    const { app, currentInFlight, finishSlow } = await appWith({ MAX_INFLIGHT_REQUESTS: "1", REQUEST_HANDLER_TIMEOUT_MS: "30000" });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const first = fetch(`${base}/slow`);
    await new Promise((r) => setTimeout(r, 50));
    expect(currentInFlight()).toBe(1);

    const shed = await fetch(`${base}/fast`);
    expect(shed.status).toBe(503);
    expect(shed.headers.get("retry-after")).toBe("2");
    expect((await fetch(`${base}/health`)).status).toBe(200);

    finishSlow();
    expect((await first).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(currentInFlight()).toBe(0);
    expect((await fetch(`${base}/fast`)).status).toBe(200); // capacity is released
    server.close();
  });

  it("answers 503 instead of hanging when a handler exceeds the timeout", async () => {
    const { app } = await appWith({ MAX_INFLIGHT_REQUESTS: "50", REQUEST_HANDLER_TIMEOUT_MS: "80" });
    const res = await request(app).get("/slow");
    expect(res.status).toBe(503);
    expect(res.body.message).toBe("Request timed out");
  });
});
