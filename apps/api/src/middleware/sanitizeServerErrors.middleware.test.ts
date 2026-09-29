import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { sanitizeServerErrors } from "./sanitizeServerErrors.middleware";

const PRISMA_LEAK =
  "\nInvalid `tx.agency.create()` invocation in\n/home/dev/app/apps/api/src/services/agency.service.ts:134:24\n\nAn operation failed because it depends on one or more records that were required but not found.";

function appWith(status: number, body: object) {
  const app = express();
  app.use(sanitizeServerErrors);
  app.get("/t", (_req, res) => res.status(status).json(body));
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe("sanitizeServerErrors", () => {
  it("scrubs Prisma/path internals from a 500 and logs the original server-side", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(appWith(500, { status: "error", message: PRISMA_LEAK })).get("/t");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Request could not be processed");
    expect(JSON.stringify(res.body)).not.toMatch(/home|invocation|prisma/i);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("GET /t"), PRISMA_LEAK);
  });

  it("also scrubs the `error` key and stack frames", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(appWith(503, { error: "Error: boom\n    at foo (/app/src/x.ts:1:2)" })).get("/t");
    expect(res.body.error).toBe("Request could not be processed");
  });

  it("leaves a harmless 500 message alone", async () => {
    const res = await request(appWith(500, { message: "Failed to load agencies" })).get("/t");
    expect(res.body.message).toBe("Failed to load agencies");
  });

  it("passes ordinary client-facing messages through on 4xx untouched", async () => {
    const res = await request(appWith(409, { message: "Email already exists" })).get("/t");
    expect(res.body.message).toBe("Email already exists");
    const res2 = await request(appWith(400, { message: "Invalid phone format" })).get("/t");
    expect(res2.body.message).toBe("Invalid phone format");
  });

  it("ALSO scrubs internals leaked through a 4xx (controllers turn Prisma errors into 400s)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(appWith(400, { success: false, message: PRISMA_LEAK })).get("/t");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/home|invocation|prisma/i);
  });
});
