import { describe, it, expect } from "vitest";
import { app } from "../app";
import { openapiSpec } from "./openapi";

/**
 * Keeps the Swagger doc honest against the real route table: every mounted
 * route must be documented, every documented path must still exist, and each
 * operation must carry the basics Swagger UI needs. Infra-free — it only walks
 * Express's router stack.
 */

type Layer = {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  regexp?: RegExp;
};

type Operation = {
  tags?: string[];
  summary?: string;
  responses?: Record<string, unknown>;
  parameters?: Array<{ name?: string; in?: string; $ref?: string }>;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const mountPathOf = (layer: Layer): string => {
  // Express 4 stores the mount path as a regexp; recover the literal prefix.
  const m = (layer.regexp?.source ?? "").match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)/);
  return m ? "/" + m[1].replace(/\\\//g, "/").replace(/\\\./g, ".") : "";
};

/** `/a/:id/` → `/a/{}` so Express and OpenAPI paths compare regardless of param names. */
const normalize = (path: string) =>
  (path.replace(/\/+$/, "") || "/").replace(/:\w+/g, "{}").replace(/\{[^}]+\}/g, "{}");

const routeTable = (): Set<string> => {
  const out = new Set<string>();
  const walk = (stack: Layer[] = [], prefix = "") => {
    for (const layer of stack) {
      if (layer.route) {
        for (const p of [layer.route.path].flat()) {
          for (const method of Object.keys(layer.route.methods)) {
            if (HTTP_METHODS.includes(method)) out.add(`${method.toUpperCase()} ${normalize(prefix + p)}`);
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPathOf(layer));
      }
    }
  };
  const root = app as unknown as { _router?: { stack: Layer[] }; router?: { stack: Layer[] } };
  walk(root._router?.stack ?? root.router?.stack ?? []);
  return out;
};

const paths = (openapiSpec as { paths?: Record<string, Record<string, Operation>> }).paths ?? {};

const documentedOps = (): Array<[string, string, Operation]> =>
  Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => HTTP_METHODS.includes(method))
      .map(([method, op]): [string, string, Operation] => [method, path, op]),
  );

describe("OpenAPI coverage", () => {
  const routes = routeTable();
  const documented = new Set(documentedOps().map(([m, p]) => `${m.toUpperCase()} ${normalize(p)}`));

  it("sees the app's route table (guards against the walker going blind)", () => {
    expect(routes.size).toBeGreaterThan(300);
  });

  it("documents every mounted route", () => {
    const missing = [...routes].filter((r) => !documented.has(r)).sort();
    expect(missing, "add an @openapi block (see src/docs/README.md)").toEqual([]);
  });

  it("documents no route that is not mounted", () => {
    const stale = [...documented].filter((d) => !routes.has(d)).sort();
    expect(stale, "remove or fix these documented paths").toEqual([]);
  });

  it("gives every operation tags, a summary, and at least one response", () => {
    const bad = documentedOps()
      .filter(([, , op]) => !op.tags?.length || !op.summary || !Object.keys(op.responses ?? {}).length)
      .map(([m, p]) => `${m.toUpperCase()} ${p}`);
    expect(bad).toEqual([]);
  });

  it("declares every {path} parameter", () => {
    const bad: string[] = [];
    for (const [method, path, op] of documentedOps()) {
      const itemParams = (paths[path] as { parameters?: Operation["parameters"] }).parameters ?? [];
      const declared = new Set(
        [...itemParams, ...(op.parameters ?? [])].filter((p) => p.in === "path").map((p) => p.name),
      );
      for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) {
        if (!declared.has(name)) bad.push(`${method.toUpperCase()} ${path} → {${name}}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
