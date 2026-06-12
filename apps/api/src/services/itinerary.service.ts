import { db } from "@funtush/database";
import {
  validateItineraryDayInput,
  validateItineraryUpdateInput,
} from "../utils/validator";

// Day 3 — Itinerary Builder.
//
// Every operation here is tenant-isolated: before touching an itinerary we
// first prove the parent package belongs to the calling agency. We never trust
// a packageId from the URL on its own.
//
// `:day` in the routes refers to the itinerary day_number (1..N), not the row
// id — it reads naturally ("delete day 3") and stays stable per package.

const notFound = (message: string) => {
  const err = new Error(message) as Error & { status?: number };
  err.status = 404;
  return err;
};

// Fetch the package scoped to the tenant, or throw 404. Used as the isolation
// gate by every itinerary operation.
const assertPackageOwned = async (agencyId: string, packageId: string) => {
  const pkg = await db.trekPackage.findFirst({
    where: { id: packageId, agencyId },
    select: { id: true },
  });
  if (!pkg) throw notFound("Package not found");
  return pkg;
};

interface AddDayInput {
  dayNumber: number;
  location?: string;
  description?: string;
  altitudeM?: number | null;
  photos?: string[];
}

// POST /agencies/packages/:id/itinerary
export const addItineraryDayService = async (
  agencyId: string,
  packageId: string,
  data: AddDayInput
) => {
  validateItineraryDayInput(data);
  await assertPackageOwned(agencyId, packageId);

  // day_number must be unique within a package — reject a duplicate up front
  // with a clear message instead of silently creating a second "Day 3".
  const clash = await db.trekItinerary.findFirst({
    where: { packageId, dayNumber: data.dayNumber },
    select: { id: true },
  });
  if (clash) {
    throw new Error(`Day ${data.dayNumber} already exists for this package`);
  }

  return db.trekItinerary.create({
    data: {
      packageId,
      dayNumber: data.dayNumber,
      location: data.location,
      description: data.description,
      altitudeM: data.altitudeM ?? undefined,
      photos: data.photos ?? [],
    },
  });
};

interface UpdateDayInput {
  location?: string;
  description?: string;
  altitudeM?: number | null;
  photos?: string[];
}

// PUT /agencies/packages/:id/itinerary/:day
export const updateItineraryDayService = async (
  agencyId: string,
  packageId: string,
  dayNumber: number,
  data: UpdateDayInput
) => {
  validateItineraryUpdateInput(data);
  await assertPackageOwned(agencyId, packageId);

  // copy only the fields actually supplied (PUT here behaves as a partial content
  // update — dayNumber is never editable here, that's what /reorder is for)
  const updateData: Record<string, unknown> = {};
  if (data.location !== undefined) updateData.location = data.location;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.altitudeM !== undefined) updateData.altitudeM = data.altitudeM;
  if (data.photos !== undefined) updateData.photos = data.photos;

  if (Object.keys(updateData).length === 0) {
    throw new Error("No fields provided to update");
  }

  // updateMany lets us scope by (packageId, dayNumber) atomically and tells us
  // via count whether the day existed.
  const result = await db.trekItinerary.updateMany({
    where: { packageId, dayNumber },
    data: updateData,
  });
  if (result.count === 0) {
    throw notFound(`Day ${dayNumber} not found for this package`);
  }

  return db.trekItinerary.findFirst({ where: { packageId, dayNumber } });
};

// DELETE /agencies/packages/:id/itinerary/:day
export const deleteItineraryDayService = async (
  agencyId: string,
  packageId: string,
  dayNumber: number
) => {
  await assertPackageOwned(agencyId, packageId);

  const day = await db.trekItinerary.findFirst({
    where: { packageId, dayNumber },
    select: { id: true },
  });
  if (!day) throw notFound(`Day ${dayNumber} not found for this package`);

  // Delete, then close the gap: every day after the removed one shifts down by
  // one so day_numbers stay contiguous 1..N. Done in a single transaction so a
  // reader never sees a half-renumbered itinerary.
  await db.$transaction([
    db.trekItinerary.delete({ where: { id: day.id } }),
    db.trekItinerary.updateMany({
      where: { packageId, dayNumber: { gt: dayNumber } },
      data: { dayNumber: { decrement: 1 } },
    }),
  ]);

  return {
    success: true,
    message: `Day ${dayNumber} removed`,
    itinerary: await db.trekItinerary.findMany({
      where: { packageId },
      orderBy: { dayNumber: "asc" },
    }),
  };
};

// PATCH /agencies/packages/:id/itinerary/reorder
// Body: { order: string[] } — itinerary row ids in the desired sequence. Each
// row's new day_number becomes its 1-based position in the array.
export const reorderItineraryService = async (
  agencyId: string,
  packageId: string,
  order: unknown
) => {
  await assertPackageOwned(agencyId, packageId);

  if (!Array.isArray(order) || order.length === 0 || order.some((id) => typeof id !== "string")) {
    throw new Error("order must be a non-empty array of itinerary ids");
  }

  const existing = await db.trekItinerary.findMany({
    where: { packageId },
    select: { id: true },
  });

  // The submitted order must be an exact permutation of this package's days —
  // no missing days, no extras, no duplicates, no ids from another package.
  const existingIds = new Set(existing.map((i) => i.id));
  const submitted = order as string[];
  if (submitted.length !== existingIds.size) {
    throw new Error("order must contain every itinerary day exactly once");
  }
  const seen = new Set<string>();
  for (const id of submitted) {
    if (!existingIds.has(id)) throw new Error(`Itinerary day ${id} does not belong to this package`);
    if (seen.has(id)) throw new Error(`Duplicate itinerary day ${id} in order`);
    seen.add(id);
  }

  // Reassign day_numbers by position, atomically. No unique constraint on
  // (packageId, dayNumber) means the intermediate states can't collide.
  await db.$transaction(
    submitted.map((id, index) =>
      db.trekItinerary.update({ where: { id }, data: { dayNumber: index + 1 } })
    )
  );

  return db.trekItinerary.findMany({
    where: { packageId },
    orderBy: { dayNumber: "asc" },
  });
};
