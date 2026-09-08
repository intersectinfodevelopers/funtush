import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@funtush/database", () => {
  const client = {
    siteAd: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      groupBy: vi.fn(),
    },
  };
  return { db: client, prisma: client, Prisma: {} };
});

import {
  createSiteAd,
  updateSiteAd,
  listSiteAds,
  listPositions,
  SiteAdError,
} from "../src/services/siteAd.service";
import { db } from "@funtush/database";

const AG = "a1";
beforeEach(() => vi.clearAllMocks());

describe("createSiteAd", () => {
  it("requires title, image and position", async () => {
    await expect(createSiteAd(AG, { image: "/x", position: "homepage-top" })).rejects.toMatchObject({ status: 400 });
    await expect(createSiteAd(AG, { title: "X", position: "homepage-top" })).rejects.toMatchObject({ status: 400 });
    await expect(createSiteAd(AG, { title: "X", image: "/x" })).rejects.toBeInstanceOf(SiteAdError);
  });

  it("maps image→imageUrl, dates, and lowercases status", async () => {
    vi.mocked(db.siteAd.create).mockImplementation(
      async (x: never) =>
        ({
          ...(x as { data: Record<string, unknown> }).data,
          id: "ad1",
          clicks: 0,
          impressions: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as never,
    );
    const ad = await createSiteAd(AG, {
      title: "Summer Promo",
      image: "/assets/everest.png",
      position: "homepage-top",
      status: "paused",
      startDate: "2026-07-01",
      endDate: "2026-08-31",
    });
    const data = vi.mocked(db.siteAd.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.imageUrl).toBe("/assets/everest.png");
    expect(data.status).toBe("PAUSED");
    expect(data.startDate).toBeInstanceOf(Date);

    expect(ad.image).toBe("/assets/everest.png");
    expect(ad.status).toBe("paused");
    expect(ad.startDate).toBe("2026-07-01");
  });
});

describe("updateSiteAd", () => {
  it("404s an unowned ad", async () => {
    vi.mocked(db.siteAd.findFirst).mockResolvedValue(null);
    await expect(updateSiteAd(AG, "nope", { status: "paused" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("listSiteAds", () => {
  it("filters by ?status=active and ?position=", async () => {
    vi.mocked(db.siteAd.findMany).mockResolvedValue([] as never);
    vi.mocked(db.siteAd.count).mockResolvedValue(0);
    await listSiteAds(AG, { status: "active", position: "sidebar-1" });
    const where = vi.mocked(db.siteAd.findMany).mock.calls[0][0].where as Record<string, unknown>;
    expect(where.status).toBe("ACTIVE");
    expect(where.position).toBe("sidebar-1");
  });
});

describe("listPositions", () => {
  it("returns the 3 known slots with active-ad counts + availability", async () => {
    vi.mocked(db.siteAd.groupBy).mockResolvedValue([
      { position: "homepage-top", _count: { _all: 2 } },
    ] as never);
    const out = await listPositions(AG);
    expect(out.map((p) => p.id)).toEqual(["homepage-top", "sidebar-1", "footer-1"]);
    expect(out.find((p) => p.id === "homepage-top")).toMatchObject({ activeAds: 2, available: false });
    expect(out.find((p) => p.id === "footer-1")).toMatchObject({ activeAds: 0, available: true });
  });
});
