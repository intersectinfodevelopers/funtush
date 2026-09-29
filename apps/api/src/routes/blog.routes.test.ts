import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the blog + blog-category routes (API-wide docs/test
 * pass, Batch 3). Service-mocked. Requests send plain JSON (no files) —
 * multer's `upload.array(...)` no-ops on a non-multipart request, leaving
 * `req.files` empty, which the controller already handles (`photos = []`).
 */

const { authState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
}));

vi.mock("src/middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.agencyId) return res.status(401).json({ message: "Refresh token is required" });
    // Real middleware sets both: tenantId (the agency-user id, used for blog author
    // attribution) and agencyId (the tenant, used for agency-wide resources like categories).
    req.tenantId = authState.agencyId;
    req.agencyId = authState.agencyId;
    next();
  },
}));

const createBlogService = vi.fn();
const updateBlogService = vi.fn();
const getBlogsService = vi.fn();

vi.mock("src/services/blog.service", () => ({
  createBlogService: (...a: unknown[]) => createBlogService(...a),
  updateBlogService: (...a: unknown[]) => updateBlogService(...a),
  getBlogsService: (...a: unknown[]) => getBlogsService(...a),
}));

// Categories now live in their own service module (blogCategory.service),
// split out of blog.service after this file was first written — the route
// (src/routes/blog.routes.ts) calls `cat.listCategories`/etc. from there.
const listCategories = vi.fn();
const createCategory = vi.fn();
const updateCategory = vi.fn();

vi.mock("../services/blogCategory.service", () => ({
  listCategories: (...a: unknown[]) => listCategories(...a),
  createCategory: (...a: unknown[]) => createCategory(...a),
  getCategory: vi.fn(),
  updateCategory: (...a: unknown[]) => updateCategory(...a),
  deleteCategory: vi.fn(),
}));

vi.mock("@funtush/storage", async () => {
  const actual = await vi.importActual<typeof import("@funtush/storage")>("@funtush/storage");
  return { ...actual, uploadFile: vi.fn() };
});
vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: blogRoutes } = await import("./blog.routes");

  const app = express();
  app.use(express.json());
  app.use("/", blogRoutes);

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
  authState.agencyId = undefined;
  createCategory.mockResolvedValue({ id: "c1" });
  updateCategory.mockResolvedValue({ id: "c1", name: "Updated" });
  listCategories.mockResolvedValue({ data: [{ id: "c1" }], stats: { total: 1, active: 1, inactive: 0, totalBeforeMonth: 0 } });
  createBlogService.mockResolvedValue({ id: "b1" });
  updateBlogService.mockResolvedValue({ id: "b1" });
  getBlogsService.mockResolvedValue({ data: [{ id: "b1" }], total: 1 });
});

function authed() {
  return { "x-refresh-token": "tok" };
}

describe("auth on every route", () => {
  it("401s all 6 endpoints without a token", async () => {
    expect((await fetch(`${baseUrl}/agencies/me/categories`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/categories`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/categories/c1`, { method: "PATCH" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/blogs`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/blogs`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/agencies/me/blogs/b1`, { method: "PATCH" })).status).toBe(401);
  });
});

describe("categories", () => {
  beforeEach(() => {
    authState.agencyId = "agencyuser-1";
  });

  it("GET lists categories", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/categories`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(listCategories).toHaveBeenCalledWith("agencyuser-1");
  });

  it("POST creates a category", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/categories`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ name: "Trekking" }),
    });
    expect(res.status).toBe(201);
    expect(createCategory).toHaveBeenCalledWith("agencyuser-1", { name: "Trekking" });
  });

  it("PATCH updates a category", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/categories/c1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(200);
    expect(updateCategory).toHaveBeenCalledWith("agencyuser-1", "c1", { name: "Renamed" });
  });

  it("surfaces a service error as 400", async () => {
    createCategory.mockRejectedValue(Object.assign(new Error("Category already exists"), { status: 400 }));
    const res = await fetch(`${baseUrl}/agencies/me/categories`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ name: "Dupe" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("blogs", () => {
  beforeEach(() => {
    authState.agencyId = "agencyuser-1";
  });

  it("GET lists blogs", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/blogs`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(getBlogsService).toHaveBeenCalledWith("agencyuser-1", expect.objectContaining({ skip: 0, take: 50 }));
    const body = (await res.json()) as { data: unknown[]; meta: { total: number; page: number; limit: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ total: 1, page: 1, limit: 50 });
  });

  it("GET clamps a hostile limit and honours page", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/blogs?page=3&limit=99999`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(getBlogsService).toHaveBeenCalledWith("agencyuser-1", expect.objectContaining({ skip: 200, take: 100 }));
  });

  it("POST creates a blog with no photos attached (photos: [])", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/blogs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ title: "Trekking in Nepal" }),
    });
    expect(res.status).toBe(201);
    expect(createBlogService).toHaveBeenCalledWith("agencyuser-1", { title: "Trekking in Nepal", photos: [], newUploads: [], tags: undefined, authorName: null });
  });

  it("PATCH updates a blog", async () => {
    const res = await fetch(`${baseUrl}/agencies/me/blogs/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ title: "Updated title" }),
    });
    expect(res.status).toBe(200);
    // No new files and no keepPhotos → photos are left alone (undefined), NOT reset to [].
    expect(updateBlogService).toHaveBeenCalledWith("agencyuser-1", "b1", { title: "Updated title", photos: undefined, newUploads: [], tags: undefined });
  });
});
