import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * BUG-201 (QA): POST /upload returned a bare HTTP 500 when the object store could not be reached
 * (`getaddrinfo ENOTFOUND` from a misconfigured STORAGE_ENDPOINT). An unreachable store is a server-side outage:
 * it must be a clear 503, never an opaque 500, and must not leak the endpoint host.
 */

const uploadFile = vi.fn();

vi.mock("@funtush/storage", () => {
  class UploadRejectedError extends Error {
    status = 400;
  }
  return {
    uploadFile: (...args: unknown[]) => uploadFile(...args),
    deleteFile: vi.fn(),
    UploadRejectedError,
  };
});

import { UploadRejectedError } from "@funtush/storage";
import { isStorageUnreachable, uploadSingle, uploadMultiple } from "./upload.controller";

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

function makeRes(reply: Reply): Response {
  return {
    status(code: number) {
      reply.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      reply.body = payload;
      return this;
    },
  } as unknown as Response;
}

const file = { size: 10, buffer: Buffer.from("x"), originalname: "a.png" };

async function single(): Promise<Reply> {
  const reply: Reply = { status: 0, body: {} };
  await uploadSingle({ file, query: {}, user: { userId: "u1" } } as unknown as Request, makeRes(reply));
  return reply;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("isStorageUnreachable", () => {
  it.each([
    ["DNS failure", { code: "ENOTFOUND" }],
    ["temporary DNS failure", { code: "EAI_AGAIN" }],
    ["refused connection", { code: "ECONNREFUSED" }],
    ["timeout", { name: "TimeoutError" }],
    ["missing credentials", { name: "CredentialsProviderError" }],
    ["code on the cause", { cause: { code: "ENOTFOUND" } }],
  ])("recognises %s", (_label, err) => {
    expect(isStorageUnreachable(err)).toBe(true);
  });

  it.each([["a plain bug", new Error("boom")], ["null", null], ["a string", "ENOTFOUND"], ["AccessDenied", { name: "AccessDenied" }]])(
    "does not treat %s as an outage",
    (_label, err) => {
      expect(isStorageUnreachable(err)).toBe(false);
    },
  );
});

describe("POST /upload", () => {
  it("returns the url on success", async () => {
    uploadFile.mockResolvedValue("https://cdn.example/uploads/u1/a.png");
    const reply = await single();
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ url: "https://cdn.example/uploads/u1/a.png" });
  });

  it("503s with a clear message — and no endpoint host — when the store is unreachable", async () => {
    uploadFile.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND funtush.secret-endpoint.example"), { code: "ENOTFOUND" }));
    const reply = await single();
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: "File storage is temporarily unavailable. Please try again later." });
    expect(JSON.stringify(reply.body)).not.toContain("secret-endpoint");
    // only the error code is logged, never the message that carries the host
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls)).not.toContain("secret-endpoint");
  });

  it("still 400s a rejected file", async () => {
    uploadFile.mockRejectedValue(new UploadRejectedError("File content is not a valid jpg, png, webp, gif or pdf."));
    const reply = await single();
    expect(reply.status).toBe(400);
  });

  it("rethrows an unexpected error so the global handler reports it", async () => {
    uploadFile.mockRejectedValue(new Error("something else"));
    await expect(single()).rejects.toThrow("something else");
  });

  it("503s the multi-file endpoint too", async () => {
    uploadFile.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    const reply: Reply = { status: 0, body: {} };
    await uploadMultiple({ files: [file], user: { userId: "u1" } } as unknown as Request, makeRes(reply));
    expect(reply.status).toBe(503);
  });
});
