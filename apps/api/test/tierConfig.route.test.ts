import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@funtush/database", () => {
  const client = {
    subscriptionTier: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  return { db: client, prisma: client, Prisma: {} };
});

import { listTiers, createTier, updateTier, TierConfigError } from "../src/services/tierConfig.service";
import { db } from "@funtush/database";

beforeEach(() => vi.clearAllMocks());

const echo = (fn: "create" | "update") =>
  vi.mocked(db.subscriptionTier[fn]).mockImplementation(
    async (x: never) =>
      ({
        id: "t1",
        name: "SMALL",
        maxStaff: 3,
        maxGuides: 5,
        maxPackages: 10,
        monthlyPrice: 29,
        annualPrice: null,
        trialDays: 30,
        marketplaceWeight: 5,
        adsEnabled: false,
        customDomainEnabled: false,
        whiteLabelComplete: false,
        apiAccessEnabled: false,
        features: {},
        ...(x as { data: Record<string, unknown> }).data,
      }) as never,
  );

describe("listTiers", () => {
  it("returns numeric prices and all §6 flags", async () => {
    vi.mocked(db.subscriptionTier.findMany).mockResolvedValue([
      {
        id: "t1",
        name: "LARGE",
        maxStaff: 100,
        maxGuides: 100,
        maxPackages: 100,
        monthlyPrice: "99.00",
        annualPrice: "990.00",
        trialDays: 0,
        marketplaceWeight: 10,
        adsEnabled: true,
        customDomainEnabled: true,
        whiteLabelComplete: true,
        apiAccessEnabled: true,
        features: { x: 1 },
      },
    ] as never);
    const [t] = await listTiers();
    expect(t.monthlyPrice).toBe(99);
    expect(t.annualPrice).toBe(990);
    expect(t.adsEnabled).toBe(true);
    expect(t.whiteLabelComplete).toBe(true);
  });
});

describe("createTier", () => {
  it("requires a name", async () => {
    await expect(createTier({ maxStaff: 1 })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects negative numbers", async () => {
    await expect(createTier({ name: "X", maxGuides: -1 })).rejects.toBeInstanceOf(TierConfigError);
  });

  it("maps P2002 to 409", async () => {
    vi.mocked(db.subscriptionTier.create).mockRejectedValue({ code: "P2002" });
    await expect(createTier({ name: "SMALL" })).rejects.toMatchObject({ status: 409 });
  });

  it("creates with §6 fields", async () => {
    echo("create");
    await createTier({
      name: "MEDIUM",
      maxPackages: 25,
      annualPrice: 590,
      adsEnabled: true,
      trialDays: 14,
    });
    const data = vi.mocked(db.subscriptionTier.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.maxPackages).toBe(25);
    expect(data.annualPrice).toBe(590);
    expect(data.adsEnabled).toBe(true);
    expect(data.trialDays).toBe(14);
  });
});

describe("updateTier", () => {
  it("404s an unknown tier", async () => {
    vi.mocked(db.subscriptionTier.findUnique).mockResolvedValue(null);
    await expect(updateTier("nope", { adsEnabled: true })).rejects.toMatchObject({ status: 404 });
  });

  it("patches only the given flags", async () => {
    vi.mocked(db.subscriptionTier.findUnique).mockResolvedValue({ id: "t1" } as never);
    echo("update");
    await updateTier("t1", { whiteLabelComplete: true, marketplaceWeight: 8 });
    const data = vi.mocked(db.subscriptionTier.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toEqual({ whiteLabelComplete: true, marketplaceWeight: 8 });
  });
});
