import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { app } from "../app";
import { openapiSpec } from "./openapi";
import { autoAuthorizeInterceptor, buildDocsHtml } from "./swaggerUi";

const HOST = "develop.shirijanga.com";

// Just the parts of the OpenAPI document these tests read.
interface Operation {
  security?: Record<string, string[]>[];
  requestBody?: { content: Record<string, { examples?: Record<string, { summary: string; value: { email: string; password: string } }> }> };
}
interface Spec {
  info: { description: string };
  components: { securitySchemes: Record<string, unknown> };
  paths: Record<string, Record<string, Operation>>;
}
const spec = openapiSpec as unknown as Spec;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

describe("Swagger UI: cache safety", () => {
  it("versions the init script URL so a stale Cloudflare copy can't be served", () => {
    const html = buildDocsHtml();
    expect(html).toMatch(/src="\.\/swagger-ui-init\.js\?v=[0-9a-f]{10}"/);
    expect(html).not.toMatch(/swagger-ui-init\.js"/); // no unversioned reference left
  });

  it("serves the page and the init script as no-store", async () => {
    const page = await request(app).get("/docs/").set("Host", HOST);
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-store");

    const init = await request(app).get("/docs/swagger-ui-init.js?v=abc").set("Host", HOST);
    expect(init.status).toBe(200);
    expect(init.headers["cache-control"]).toBe("no-store");
  });

  it("serves /docs.json as no-store", async () => {
    const res = await request(app).get("/docs.json").set("Host", HOST);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("Swagger UI: browser script", () => {
  it("embeds a valid, self-contained auto-authorize interceptor", async () => {
    const init = await request(app).get("/docs/swagger-ui-init.js").set("Host", HOST);
    const js = init.text;
    expect(js).toContain("persistAuthorization");
    expect(js).toContain("authActions.authorize");
    // The TS toolchain's keepNames helper doesn't exist in the browser.
    expect(js).not.toContain("__name(");
    expect(autoAuthorizeInterceptor.toString()).not.toContain("__name");
    // Whole script must at least parse as JavaScript.
    expect(() => new Function(js)).not.toThrow();
  });
});

describe("Swagger UI: auto-authorize after login", () => {
  const authorize = vi.fn();
  afterEach(() => {
    authorize.mockReset();
    delete (globalThis as { ui?: unknown }).ui;
  });
  const withUi = () => {
    (globalThis as { ui?: unknown }).ui = { authActions: { authorize } };
  };
  const tokens = { accessToken: "ACCESS.jwt", refreshToken: "REFRESH.jwt" };

  it.each([
    ["/auth/admin/login"],
    ["/auth/agency/login"],
    ["/auth/trekker/login"],
    ["/auth/refresh"],
  ])("authorizes after a successful %s", (path) => {
    withUi();
    const res = { url: `https://x.test${path}`, status: 200, body: tokens };
    expect(autoAuthorizeInterceptor(res)).toBe(res); // response passes through untouched
    expect(authorize).toHaveBeenCalledOnce();
    const arg = authorize.mock.calls[0][0];
    expect(arg.bearerAuth).toMatchObject({ value: "ACCESS.jwt", schema: { type: "http", scheme: "bearer" } });
    expect(arg.refreshToken).toMatchObject({ value: "REFRESH.jwt", schema: { type: "apiKey", name: "x-refresh-token" } });
  });

  it("understands a { data: {...} } envelope and a JSON string body", () => {
    withUi();
    autoAuthorizeInterceptor({ url: "https://x.test/auth/admin/login", status: 200, body: { data: tokens } });
    autoAuthorizeInterceptor({ url: "https://x.test/auth/admin/login", status: 200, body: JSON.stringify(tokens) });
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("does nothing for failed logins and unrelated endpoints", () => {
    withUi();
    autoAuthorizeInterceptor({ url: "https://x.test/auth/agency/login", status: 401, body: { message: "Invalid credentials" } });
    autoAuthorizeInterceptor({ url: "https://x.test/agencies/me/dashboard", status: 200, body: tokens });
    autoAuthorizeInterceptor({ url: "https://x.test/auth/agency/login?x=1", status: 200, body: {} });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("never throws, even on a malformed body or a missing ui", () => {
    const res = { url: "https://x.test/auth/admin/login", status: 200, body: "{not json" };
    expect(() => autoAuthorizeInterceptor(res)).not.toThrow();
    expect(() => autoAuthorizeInterceptor({ url: "https://x.test/auth/admin/login", status: 200, body: tokens })).not.toThrow();
  });
});

describe("OpenAPI spec: auth documentation", () => {
  const ops = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([m]) => HTTP_METHODS.includes(m))
      .map(([m, op]) => ({ id: `${m.toUpperCase()} ${path}`, op })),
  );

  it("every operation's security requirement names a defined security scheme", () => {
    const defined = new Set(Object.keys(spec.components.securitySchemes));
    const bad = ops.flatMap(({ id, op }) =>
      (op.security ?? []).flatMap((req) => Object.keys(req)).filter((name) => !defined.has(name)).map((name) => `${id} → ${name}`),
    );
    expect(bad).toEqual([]);
  });

  it("each login endpoint offers the matching QA account(s) as named examples (see docs/QA_TEST_ACCOUNTS.md)", () => {
    const examples = (path: string) => spec.paths[path].post.requestBody?.content["application/json"].examples ?? {};
    const accounts = (path: string) => Object.values(examples(path)).map((e) => `${e.value.email} / ${e.value.password}`);
    expect(accounts("/auth/admin/login")).toEqual(["admin@funtush.com / Test@123"]);
    expect(accounts("/auth/agency/login")).toEqual(["agency@funtush.com / Test@123"]);
    expect(accounts("/auth/trekker/login")).toEqual(["test@auth.com / Test@123", "john@test.com / Test@123"]);
    expect(Object.keys(examples("/auth/admin/login"))).toEqual(["superAdmin"]);
    expect(Object.keys(examples("/auth/agency/login"))).toEqual(["agencyAdmin"]);
  });

  it("the description explains the Super Admin and Agency Admin quick start", () => {
    const d = spec.info.description;
    expect(d).toContain("Quick start");
    expect(d).toContain("admin@funtush.com");
    expect(d).toContain("agency@funtush.com");
    expect(d).toContain("x-refresh-token");
  });
});
