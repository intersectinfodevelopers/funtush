import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./app";
import { openapiSpec as rawSpec } from "./docs/openapi";

// "live behaviour" needs the full docker-compose.test.yml stack: a *seeded*
// Postgres (plus Redis/Mongo). CI only starts a bare, unseeded Postgres, so use
// "are subscription tiers seeded?" as the proxy for "full stack present" and
// skip that block otherwise. The static routing / OpenAPI checks below never
// touch infra and always run.
const liveInfraReady: boolean = await (async () => {
  try {
    const { db } = await import("@funtush/database");
    await db.$queryRaw`SELECT 1`;
    return (await db.subscriptionTier.count()) > 0;
  } catch {
    return false;
  }
})();

const openapiSpec = rawSpec as {
  openapi?: string;
  info?: { title?: string };
  paths?: Record<string, unknown>;
};

/**
 * Boot-level checks for the consolidated app: every router is mounted (no
 * accidental 404s), the OpenAPI doc is well-formed, and no two routes claim the
 * same method + path.
 */

// Representative request per mounted base path. A route that is mounted returns
// 200/400/401/403 (auth/validation); a route that is NOT mounted returns 404.
const MOUNTED_PATHS: Array<[string, string]> = [
  ["get", "/health"],
  ["get", "/subscription-tiers"],
  ["post", "/auth/agency/login"],
  ["post", "/auth/refresh"],
  ["patch", "/agencies/me/profile"],
  ["get", "/agencies/me/kyc"],
  ["get", "/agencies/packages"],
  ["get", "/agencies/packages/pkg-x/addons"],
  ["post", "/agencies/packages/pkg-x/addons"],
  ["get", "/agencies/me/customers"],
  ["get", "/agencies/me/customers/analytics"],
  ["get", "/agencies/me/staff"],
  ["patch", "/agencies/me/staff/st-x"],
  ["get", "/agencies/me/roles"],
  ["get", "/agencies/me/roles/permissions"],
  ["get", "/agencies/me/break-glass"],
  ["get", "/agencies/me/guides"],
  ["post", "/agencies/me/guides"],
  ["get", "/agencies/me/blogs"],
  ["post", "/agencies/me/blogs"],
  ["get", "/agencies/me/categories"],
  ["get", "/agencies/me/gallery"],
  ["post", "/agencies/me/gallery"],
  ["get", "/agencies/me/videos"],
  ["post", "/agencies/me/videos"],
  ["get", "/agencies/me/destinations"],
  ["post", "/agencies/me/destinations"],
  ["get", "/agencies/me/advertisements"],
  ["post", "/agencies/me/advertisements"],
  ["get", "/agencies/me/advertisements/positions"],
  ["get", "/agencies/me/branches"],
  ["get", "/agencies/me/coupons"],
  ["get", "/agencies/me/widgets"],
  ["get", "/agencies/me/analytics"],
  ["get", "/agencies/me/safety/incidents/active"],
  ["get", "/agencies/me/safety/incidents"],
  ["get", "/agencies/me/reports/monthly"],
  ["get", "/agencies/me/finance/pnl"],
  ["get", "/agencies/me/finance/invoices"],
  ["post", "/agencies/me/finance/invoices"],
  ["get", "/agencies/me/payment-methods"],
  ["get", "/agencies/me/api-keys"],
  ["get", "/agencies/me/bugs"],
  ["get", "/agencies/me/ad-campaigns"],
  ["get", "/billing/fonepay/status"],
  ["get", "/bookings"],
  ["post", "/bookings"],
  ["post", "/bookings/inquiry"],
  ["patch", "/bookings/bk-x/assign-guide"],
  ["get", "/marketplace/agencies"],
  ["get", "/marketplace/packages"],
  ["get", "/mobile/trekker/dashboard"],
  ["post", "/sos/trigger"],
  ["post", "/emails/welcome"],
  ["get", "/admin/dashboard"],
  ["get", "/admin/agencies"],
  ["get", "/admin/kyc"],
  ["get", "/admin/tiers"],
  ["get", "/admin/analytics"],
  ["get", "/admin/sos/active"],
  ["get", "/admin/email-queue"],
  ["get", "/admin/fraud/queue"],
  ["get", "/admin/break-glass"],
  ["post", "/admin/break-glass"],
];

describe("app: OpenAPI doc", () => {
  it("is a well-formed OpenAPI 3 document with paths", () => {
    expect(String(openapiSpec.openapi)).toMatch(/^3\./);
    expect(openapiSpec.info?.title).toBe("Funtush API");
    expect(Object.keys(openapiSpec.paths ?? {}).length).toBeGreaterThan(10);
  });

  it("serves the spec at /docs.json", async () => {
    const res = await request(app).get("/docs.json");
    expect(res.status).toBe(200);
    expect(String(res.body.openapi)).toMatch(/^3\./);
  });
});

describe("app: routing", () => {
  it("responds on /health (200 or 503, never a routing 404)", async () => {
    const res = await request(app).get("/health");
    expect([200, 503]).toContain(res.status);
  });

  it.each(MOUNTED_PATHS)("%s %s is mounted (not 404)", async (method, path) => {
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
      method
    ](path);
    expect(res.status).not.toBe(404);
  });

  it("has no duplicate method + path across all routers", () => {
    const seen = new Map<string, number>();

    type Layer = {
      route?: { path: string | string[]; methods: Record<string, boolean> };
      name?: string;
      handle?: { stack?: Layer[] };
      regexp?: RegExp;
    };

    const mountPathOf = (layer: Layer): string => {
      // Express stores the mount path as a regexp; recover the literal prefix.
      const src = layer.regexp?.source ?? "";
      const m = src.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)/);
      if (!m) return "";
      return "/" + m[1].replace(/\\\//g, "/").replace(/\\\./g, ".");
    };

    const walk = (stack: Layer[] = [], prefix = "") => {
      for (const layer of stack) {
        if (layer.route) {
          const paths = Array.isArray(layer.route.path)
            ? layer.route.path
            : [layer.route.path];
          for (const p of paths) {
            for (const method of Object.keys(layer.route.methods)) {
              const key = `${method.toUpperCase()} ${prefix}${p}`;
              seen.set(key, (seen.get(key) ?? 0) + 1);
            }
          }
        } else if (layer.handle?.stack) {
          walk(layer.handle.stack, prefix + mountPathOf(layer));
        }
      }
    };

    const root = (app as unknown as { _router?: { stack: Layer[] }; router?: { stack: Layer[] } });
    walk(root._router?.stack ?? root.router?.stack ?? []);

    const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dups).toEqual([]);
  });
});

// Infra-free behavioural checks — always run.
describe("app: static behaviour", () => {
  it("GET /docs → serves Swagger UI HTML", async () => {
    const res = await request(app).get("/docs/").redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/swagger-ui/i);
  });

  it("GET /docs.json → valid OpenAPI 3 with security schemes", async () => {
    const res = await request(app).get("/docs.json");
    expect(res.status).toBe(200);
    expect(String(res.body.openapi)).toMatch(/^3\./);
    expect(res.body.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(res.body.components?.securitySchemes).toHaveProperty("refreshToken");
  });

  it("auth-gated routes reject anonymous callers with 401/403 (not 500)", async () => {
    for (const path of [
      "/agencies/me/roles",
      "/agencies/me/guides",
      "/agencies/me/staff",
      "/agencies/me/finance/pnl",
      "/admin/dashboard",
      "/admin/kyc",
    ]) {
      const res = await request(app).get(path);
      expect([401, 403], `${path} → ${res.status}`).toContain(res.status);
    }
  });

  it("unknown route → 404", async () => {
    const res = await request(app).get("/definitely/not/a/route");
    expect(res.status).toBe(404);
  });
});

// Needs a seeded Postgres + reachable Redis (docker-compose.test.yml). Skips in
// CI, which starts only a bare Postgres.
(liveInfraReady ? describe : describe.skip)("app: live behaviour", () => {
  it("GET /health → 200 with db+redis ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "ok", redis: "ok" });
  });

  it("GET /subscription-tiers → tiers from the real DB", async () => {
    const res = await request(app).get("/subscription-tiers");
    expect(res.status).toBe(200);
    const tiers = res.body?.data?.tiers ?? res.body?.data ?? res.body;
    expect(Array.isArray(tiers)).toBe(true);
    expect(tiers.length).toBeGreaterThan(0);
    expect(tiers[0]).toHaveProperty("name");
  });

  it("GET /marketplace/agencies → 200 JSON (public)", async () => {
    const res = await request(app).get("/marketplace/agencies");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/json/);
  });
});
