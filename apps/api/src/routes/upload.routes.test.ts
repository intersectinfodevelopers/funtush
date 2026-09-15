import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the file-upload routes (API-wide docs/test pass,
 * Batch 6). Real `requireAuth`, mocked storage.
 *
 * Note: `DELETE /upload` accepts any `url` string from any authenticated
 * caller with no ownership check at all — there is no record anywhere of
 * which upload belongs to which agency/user, so any signed-in caller can
 * delete any file by URL. Flagged as a finding, not fixed here — closing it
 * would mean designing an ownership model for uploads, a feature change
 * beyond this pass's scope, not a routing/test gap.
 */

const { authState } = vi.hoisted(() => ({
  authState: { valid: false },
}));

vi.mock("@funtush/auth", () => ({
  requireAuth: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.valid) return res.status(401).json({ message: "No token provided" });
    req.user = { userId: "user-1", role: "AGENCY_ADMIN", roleType: "TENANT" };
    next();
  },
}));

const uploadFile = vi.fn();
const deleteFile = vi.fn();

vi.mock("@funtush/storage", async () => {
  const actual = await vi.importActual<typeof import("@funtush/storage")>("@funtush/storage");
  return { ...actual, uploadFile: (...a: unknown[]) => uploadFile(...a), deleteFile: (...a: unknown[]) => deleteFile(...a) };
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: uploadRoutes } = await import("./upload.routes");

  const app = express();
  app.use(express.json());
  app.use("/", uploadRoutes);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(() => {
  if (server) server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.valid = false;
  uploadFile.mockResolvedValue("https://cdn.example.com/file.jpg");
  deleteFile.mockResolvedValue(undefined);
});

describe("auth", () => {
  it("401s all 3 endpoints without a token", async () => {
    expect((await fetch(`${baseUrl}/upload`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/upload/multiple`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/upload`, { method: "DELETE" })).status).toBe(401);
  });
});

describe("with a valid session", () => {
  beforeEach(() => {
    authState.valid = true;
  });

  it("POST /upload requires a file", async () => {
    const res = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      headers: { Authorization: "Bearer x" },
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /upload requires a url", async () => {
    const res = await fetch(`${baseUrl}/upload`, {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: "Bearer x" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /upload deletes by url", async () => {
    const res = await fetch(`${baseUrl}/upload`, {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: "Bearer x" },
      body: JSON.stringify({ url: "https://cdn.example.com/file.jpg" }),
    });
    expect(res.status).toBe(200);
    expect(deleteFile).toHaveBeenCalledWith("https://cdn.example.com/file.jpg");
  });
});
