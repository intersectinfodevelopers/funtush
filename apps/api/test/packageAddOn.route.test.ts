import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@funtush/database", () => {
  const client = {
    trekPackage: { findFirst: vi.fn() },
    trekAddOn: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { db: client, prisma: client };
});

import {
  listAddOns,
  createAddOn,
  updateAddOn,
  deleteAddOn,
  PackageAddOnError,
} from "../src/services/packageAddOn.service";
import { db } from "@funtush/database";

const AG = "a1";
const PKG = "pkg1";
const own = () => vi.mocked(db.trekPackage.findFirst).mockResolvedValue({ id: PKG } as never);
beforeEach(() => vi.clearAllMocks());

describe("ownership", () => {
  it("404s when the package isn't the agency's", async () => {
    vi.mocked(db.trekPackage.findFirst).mockResolvedValue(null);
    await expect(listAddOns(AG, PKG)).rejects.toMatchObject({ status: 404 });
  });
});

describe("createAddOn", () => {
  it("requires a name and a valid price", async () => {
    own();
    await expect(createAddOn(AG, PKG, { price: 10 })).rejects.toMatchObject({ status: 400 });
    await expect(createAddOn(AG, PKG, { name: "Porter", price: -1 })).rejects.toBeInstanceOf(
      PackageAddOnError,
    );
    await expect(createAddOn(AG, PKG, { name: "Porter", price: "abc" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("stores a numeric price and returns it as a number", async () => {
    own();
    vi.mocked(db.trekAddOn.create).mockImplementation(
      async (x: never) =>
        ({ ...(x as { data: Record<string, unknown> }).data, id: "ao1", createdAt: new Date() }) as never,
    );
    const ao = await createAddOn(AG, PKG, { name: "Porter", price: "25.50", perPerson: true });
    const data = vi.mocked(db.trekAddOn.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.price).toBe(25.5);
    expect(data.perPerson).toBe(true);
    expect(ao.price).toBe(25.5);
  });
});

describe("updateAddOn / deleteAddOn", () => {
  it("404s an add-on not on this package", async () => {
    own();
    vi.mocked(db.trekAddOn.findFirst).mockResolvedValue(null);
    await expect(updateAddOn(AG, PKG, "x", { name: "y" })).rejects.toMatchObject({ status: 404 });
  });

  it("blocks deleting an add-on that's on a booking (409)", async () => {
    own();
    vi.mocked(db.trekAddOn.findFirst).mockResolvedValue({ id: "ao1", bookingAddOns: [{ id: "b1" }] } as never);
    await expect(deleteAddOn(AG, PKG, "ao1")).rejects.toMatchObject({ status: 409 });
  });

  it("deletes an unused add-on", async () => {
    own();
    vi.mocked(db.trekAddOn.findFirst).mockResolvedValue({ id: "ao1", bookingAddOns: [] } as never);
    await deleteAddOn(AG, PKG, "ao1");
    expect(db.trekAddOn.delete).toHaveBeenCalledWith({ where: { id: "ao1" } });
  });
});
