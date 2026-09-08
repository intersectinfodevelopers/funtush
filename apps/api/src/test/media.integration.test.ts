// Media module (gallery + videos) — integration tests (Phase 2). Real DB, skip if down.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

type Database = typeof import("@funtush/database");
type MediaService = typeof import("../services/media.service");

let DB_AVAILABLE = false;
let db: Database["db"];
let svc: MediaService;
let tierId = "";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
  const database = await import("@funtush/database");
  db = database.db;
  await db.$queryRaw`SELECT 1`;
  const tier = await db.subscriptionTier.upsert({
    where: { name: "MEDIA_TEST_TIER" },
    update: {},
    create: { name: "MEDIA_TEST_TIER", maxStaff: 5, maxGuides: 5, monthlyPrice: 0, features: {} },
    select: { id: true },
  });
  tierId = tier.id;
  svc = await import("../services/media.service");
  DB_AVAILABLE = true;
} catch (error) {
  console.warn(`[media.integration] DB unavailable — skipping (${error instanceof Error ? error.message : error})`);
}

const d = DB_AVAILABLE ? describe : describe.skip;
let agencyId = "";

d("Media module (real DB)", () => {
  beforeAll(async () => {
    const s = `${Date.now()}`;
    const a = await db.agency.create({
      data: { name: `Media Test ${s}`, email: `mediatest-${s}@example.com`, slug: `mediatest-${s}`, tierId },
    });
    agencyId = a.id;
  });
  afterAll(async () => {
    if (agencyId) await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
  });

  it("gallery: create → list(filter) → update images → delete", async () => {
    const g = await svc.createGallery(agencyId, {
      title: "Khumbu Valley Sunset",
      description: "Sunset over the Khumbu valley.",
      category: "Nature",
      images: ["/g/1.jpg", "/g/2.jpg"],
      status: "published",
      order: 1,
    });
    expect(g.status).toBe("published");
    expect(g.featuredImage).toBe("/g/1.jpg");

    expect((await svc.listGallery(agencyId, { status: "published" })).total).toBe(1);
    expect((await svc.listGallery(agencyId, { status: "draft" })).total).toBe(0);

    const upd = await svc.updateGallery(agencyId, g.id, { images: ["/g/3.jpg"], status: "draft" });
    expect(upd.images).toEqual(["/g/3.jpg"]);
    expect(upd.featuredImage).toBe("/g/3.jpg");
    expect(upd.status).toBe("draft");

    await svc.deleteGallery(agencyId, g.id);
    await expect(svc.getGallery(agencyId, g.id)).rejects.toMatchObject({ status: 404 });
  });

  it("videos: create → get → update → delete", async () => {
    const v = await svc.createVideo(agencyId, {
      title: "Everest Base Camp Overview",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      thumbnail: "/v/ebc.jpg",
      status: "active",
      order: 1,
    });
    expect(v.thumbnail).toBe("/v/ebc.jpg");
    expect(v.status).toBe("active");

    const got = await svc.getVideo(agencyId, v.id);
    expect(got.title).toBe("Everest Base Camp Overview");

    const upd = await svc.updateVideo(agencyId, v.id, { status: "inactive", title: "EBC Overview v2" });
    expect(upd.status).toBe("inactive");
    expect(upd.title).toBe("EBC Overview v2");

    await svc.deleteVideo(agencyId, v.id);
    await expect(svc.getVideo(agencyId, v.id)).rejects.toMatchObject({ status: 404 });
  });
});
