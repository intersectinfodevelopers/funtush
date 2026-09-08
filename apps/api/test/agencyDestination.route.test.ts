import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@funtush/database", () => {
  const client = {
    agencyDestination: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { db: client, prisma: client, Prisma: {} };
});

import {
  createDestination,
  updateDestination,
  listDestinations,
  deleteDestination,
  AgencyDestinationError,
} from "../src/services/agencyDestination.service";
import { db } from "@funtush/database";

const AG = "a1";
beforeEach(() => vi.clearAllMocks());

const echo = () =>
  vi.mocked(db.agencyDestination.create).mockImplementation(
    async (x: never) =>
      ({
        ...(x as { data: Record<string, unknown> }).data,
        id: "d1",
        rating: null,
        reviewCount: 0,
        views: 0,
        saves: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as never,
  );

describe("createDestination", () => {
  it("requires a title", async () => {
    await expect(createDestination(AG, {})).rejects.toBeInstanceOf(AgencyDestinationError);
  });

  it("slugifies title, parses '5,364m' → 5364, returns nested duration/altitude", async () => {
    vi.mocked(db.agencyDestination.findFirst).mockResolvedValue(null);
    echo();
    const d = await createDestination(AG, {
      title: "Everest Base Camp",
      altitudeMax: "5,364m",
      durationMin: "12",
      durationMax: 14,
      bestSeason: "Autumn/Spring",
    });
    const data = vi.mocked(db.agencyDestination.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.slug).toBe("everest-base-camp");
    expect(data.altitudeMaxM).toBe(5364);
    expect(data.durationMinDays).toBe(12);
    expect(data.bestTimeToVisit).toBe("Autumn/Spring");

    expect(d.altitude).toEqual({ min: null, max: 5364 });
    expect(d.duration).toEqual({ min: 12, max: 14 });
    expect(d.engagement).toEqual({ views: 0, saves: 0 });
    expect(d.bestSeason).toBe("Autumn/Spring");
  });
});

describe("updateDestination", () => {
  it("404s an unowned destination", async () => {
    vi.mocked(db.agencyDestination.findFirst).mockResolvedValue(null);
    await expect(updateDestination(AG, "x", { title: "y" })).rejects.toMatchObject({ status: 404 });
  });

  it("toggles published + featured via the main patch", async () => {
    vi.mocked(db.agencyDestination.findFirst).mockResolvedValue({ id: "d1" } as never);
    vi.mocked(db.agencyDestination.update).mockImplementation(
      async (x: never) =>
        ({
          id: "d1",
          title: "t",
          slug: "t",
          activities: [],
          gallery: [],
          rating: null,
          reviewCount: 0,
          views: 0,
          saves: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(x as { data: Record<string, unknown> }).data,
        }) as never,
    );
    await updateDestination(AG, "d1", { published: true, featured: true });
    const data = vi.mocked(db.agencyDestination.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.published).toBe(true);
    expect(data.featured).toBe(true);
  });
});

describe("listDestinations", () => {
  it("filters by ?published=true and ?featured=true", async () => {
    vi.mocked(db.agencyDestination.findMany).mockResolvedValue([] as never);
    vi.mocked(db.agencyDestination.count).mockResolvedValue(0);
    await listDestinations(AG, { published: "true", featured: "true" });
    const where = vi.mocked(db.agencyDestination.findMany).mock.calls[0][0].where as Record<string, unknown>;
    expect(where.published).toBe(true);
    expect(where.featured).toBe(true);
  });
});

describe("deleteDestination", () => {
  it("404s unknown", async () => {
    vi.mocked(db.agencyDestination.findFirst).mockResolvedValue(null);
    await expect(deleteDestination(AG, "x")).rejects.toMatchObject({ status: 404 });
  });
});
