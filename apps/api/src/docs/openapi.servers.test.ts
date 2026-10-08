import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * BUG-002 (QA): importing docs.json into Postman gave a base URL of http://localhost:4000. The environment's own public
 * origin (API_PUBLIC_URL) must come first so imports use it; "/" (Swagger UI) and localhost (developers) follow.
 */

type Spec = { servers: { url: string; description?: string }[] };

async function loadSpec(env: Record<string, string | undefined>): Promise<Spec> {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const { openapiSpec } = await import("./openapi");
    return openapiSpec as unknown as Spec;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

vi.setConfig({ testTimeout: 30_000 }); // building the spec scans every route file for @openapi blocks

afterEach(() => vi.resetModules());

describe("OpenAPI servers", () => {
  it("lists this environment first when API_PUBLIC_URL is set (trailing slash trimmed)", async () => {
    const spec = await loadSpec({ API_PUBLIC_URL: "https://develop.shirijanga.com/", PORT: "4000" });
    expect(spec.servers.map((s) => s.url)).toEqual(["https://develop.shirijanga.com", "/", "http://localhost:4000"]);
    expect(spec.servers[0].description).toBe("This environment");
  });

  it("keeps the same-origin and localhost entries when API_PUBLIC_URL is not set", async () => {
    const spec = await loadSpec({ API_PUBLIC_URL: undefined, PORT: "4000" });
    expect(spec.servers.map((s) => s.url)).toEqual(["/", "http://localhost:4000"]);
  });

  it("ignores a blank API_PUBLIC_URL", async () => {
    const spec = await loadSpec({ API_PUBLIC_URL: "   ", PORT: "4000" });
    expect(spec.servers).toHaveLength(2);
  });
});
