import { db } from "@funtush/database";

/**
 * Trek package add-ons (`TrekAddOn`). Same agency-scoping pattern as
 * departureDate.service.ts (assertPackageOwned).
 */

export class PackageAddOnError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function assertPackageOwned(agencyId: string, packageId: string): Promise<void> {
  const pkg = await db.trekPackage.findFirst({
    where: { id: packageId, agencyId },
    select: { id: true },
  });
  if (!pkg) throw new PackageAddOnError(404, "Package not found.");
}

type AddOnRow = { id: string; name: string; price: unknown; perPerson: boolean; createdAt: Date };
function toApi(r: AddOnRow) {
  return {
    id: r.id,
    name: r.name,
    price: Number(r.price),
    perPerson: r.perPerson,
    createdAt: r.createdAt,
  };
}

export async function listAddOns(agencyId: string, packageId: string) {
  await assertPackageOwned(agencyId, packageId);
  const rows = await db.trekAddOn.findMany({
    where: { packageId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => toApi(r as AddOnRow));
}

export interface AddOnInput {
  name?: string;
  price?: number | string;
  perPerson?: boolean;
}

function parsePrice(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export async function createAddOn(agencyId: string, packageId: string, body: AddOnInput) {
  await assertPackageOwned(agencyId, packageId);
  const name = (body.name ?? "").trim();
  const price = parsePrice(body.price);
  if (!name) throw new PackageAddOnError(400, "Add-on name is required.");
  if (Number.isNaN(price)) throw new PackageAddOnError(400, "A valid non-negative price is required.");

  const row = await db.trekAddOn.create({
    data: { packageId, name, price, perPerson: body.perPerson ?? false },
  });
  return toApi(row as AddOnRow);
}

export async function updateAddOn(
  agencyId: string,
  packageId: string,
  addOnId: string,
  body: AddOnInput,
) {
  await assertPackageOwned(agencyId, packageId);
  const existing = await db.trekAddOn.findFirst({
    where: { id: addOnId, packageId },
    select: { id: true },
  });
  if (!existing) throw new PackageAddOnError(404, "Add-on not found.");

  const data: { name?: string; price?: number; perPerson?: boolean } = {};
  if (body.name !== undefined) {
    const n = body.name.trim();
    if (!n) throw new PackageAddOnError(400, "Add-on name cannot be empty.");
    data.name = n;
  }
  if (body.price !== undefined) {
    const p = parsePrice(body.price);
    if (Number.isNaN(p)) throw new PackageAddOnError(400, "A valid non-negative price is required.");
    data.price = p;
  }
  if (body.perPerson !== undefined) data.perPerson = body.perPerson;

  const row = await db.trekAddOn.update({ where: { id: addOnId }, data });
  return toApi(row as AddOnRow);
}

export async function deleteAddOn(agencyId: string, packageId: string, addOnId: string) {
  await assertPackageOwned(agencyId, packageId);
  const existing = await db.trekAddOn.findFirst({
    where: { id: addOnId, packageId },
    select: { id: true, bookingAddOns: { select: { id: true }, take: 1 } },
  });
  if (!existing) throw new PackageAddOnError(404, "Add-on not found.");
  if (existing.bookingAddOns.length > 0) {
    throw new PackageAddOnError(
      409,
      "This add-on is attached to existing bookings and cannot be deleted.",
    );
  }
  await db.trekAddOn.delete({ where: { id: addOnId } });
}
