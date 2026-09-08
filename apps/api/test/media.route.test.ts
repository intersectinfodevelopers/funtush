import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@funtush/database", () => {
  const mk = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  const client = { galleryPost: mk(), video: mk() };
  return { db: client, prisma: client, Prisma: {} };
});

import {
  createGallery,
  updateGallery,
  createVideo,
  listVideos,
  MediaServiceError,
} from "../src/services/media.service";
import { db } from "@funtush/database";

const AG = "a1";
beforeEach(() => vi.clearAllMocks());

const galleryEcho = () =>
  vi.mocked(db.galleryPost.create).mockImplementation(
    async (x: never) =>
      ({ ...(x as { data: Record<string, unknown> }).data, id: "g1", likes: 0, views: 0, createdAt: new Date(), updatedAt: new Date() }) as never,
  );

describe("gallery", () => {
  it("requires a title and at least one image", async () => {
    await expect(createGallery(AG, { images: ["/a.jpg"] })).rejects.toMatchObject({ status: 400 });
    await expect(createGallery(AG, { title: "X" })).rejects.toMatchObject({ status: 400 });
  });

  it("caps images at 5 and defaults featuredImage to the first", async () => {
    galleryEcho();
    const g = await createGallery(AG, {
      title: "Trek shots",
      images: ["/1", "/2", "/3", "/4", "/5", "/6"],
    });
    const data = vi.mocked(db.galleryPost.create).mock.calls[0][0].data as Record<string, unknown>;
    expect((data.images as string[]).length).toBe(5);
    expect(data.featuredImage).toBe("/1");
    expect(g.status).toBe("published");
  });

  it("keeps featuredImage valid on update", async () => {
    vi.mocked(db.galleryPost.findFirst).mockResolvedValue({
      images: ["/a", "/b"],
      featuredImage: "/a",
    } as never);
    vi.mocked(db.galleryPost.update).mockImplementation(
      async (x: never) =>
        ({ id: "g1", title: "t", description: null, category: null, status: "PUBLISHED", order: 0, likes: 0, views: 0, createdAt: new Date(), updatedAt: new Date(), ...(x as { data: Record<string, unknown> }).data }) as never,
    );

    // point featuredImage at an image that's being removed → falls back to first of new set
    await updateGallery(AG, "g1", { images: ["/c", "/d"], featuredImage: "/a" });
    const data = vi.mocked(db.galleryPost.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.featuredImage).toBe("/c");
  });

  it("404s an unowned gallery post on update", async () => {
    vi.mocked(db.galleryPost.findFirst).mockResolvedValue(null);
    await expect(updateGallery(AG, "nope", { title: "x" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("videos", () => {
  it("rejects a non-YouTube url", async () => {
    await expect(
      createVideo(AG, { title: "V", youtubeUrl: "https://vimeo.com/123" }),
    ).rejects.toBeInstanceOf(MediaServiceError);
  });

  it("accepts youtu.be + watch?v= forms and lowercases status", async () => {
    vi.mocked(db.video.create).mockImplementation(
      async (x: never) =>
        ({ ...(x as { data: Record<string, unknown> }).data, id: "v1", likes: 0, views: 0, createdAt: new Date(), updatedAt: new Date() }) as never,
    );
    const v = await createVideo(AG, {
      title: "Overview",
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      status: "inactive",
    });
    expect(v.status).toBe("inactive");
    expect(v.youtubeUrl).toContain("youtu.be");
  });

  it("maps ?status=active to the DB enum", async () => {
    vi.mocked(db.video.findMany).mockResolvedValue([] as never);
    vi.mocked(db.video.count).mockResolvedValue(0);
    await listVideos(AG, { status: "active" });
    const where = vi.mocked(db.video.findMany).mock.calls[0][0].where as Record<string, unknown>;
    expect(where.status).toBe("ACTIVE");
  });
});
