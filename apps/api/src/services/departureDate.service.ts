import { db, type DepartureStatus, type Prisma } from "@funtush/database";
import {
  validateDepartureDateInput,
  validateDepartureUpdateInput,
} from "../utils/validator";

// Day 4 — Departure Dates & slot management.
//
// A departure date is the per-package, dated slot pool a trekker books against.
// `maxSlots` is the total head-count capacity; `bookedSlots` is how many of those
// seats are already taken by CONFIRMED bookings. When bookedSlots reaches maxSlots
// the date flips to FULL and no new inquiries are accepted — this is what prevents
// overbooking.
//
// Every operation is tenant-isolated: we prove the parent package belongs to the
// calling agency before touching its dates. We never trust a packageId or dateId
// from the URL on its own.

const notFound = (message: string) => {
  const err = new Error(message) as Error & { status?: number };
  err.status = 404;
  return err;
};

// Fetch the package scoped to the tenant, or throw 404. Isolation gate for every
// departure-date operation.
const assertPackageOwned = async (agencyId: string, packageId: string) => {
  const pkg = await db.trekPackage.findFirst({
    where: { id: packageId, agencyId },
    select: { id: true },
  });
  if (!pkg) throw notFound("Package not found");
  return pkg;
};

// Fetch a departure date and confirm it belongs to the given package, or throw 404.
const getOwnedDeparture = async (packageId: string, dateId: string) => {
  const departure = await db.trekDepartureDate.findFirst({
    where: { id: dateId, packageId },
  });
  if (!departure) throw notFound("Departure date not found for this package");
  return departure;
};

// Derive status from the slot counts. A date is FULL once every seat is taken.
// We never silently downgrade a GUARANTEED date — that's a deliberate agency
// promise — but we DO promote it to FULL when it sells out.
const deriveStatus = (
  bookedSlots: number,
  maxSlots: number,
  current: DepartureStatus
): DepartureStatus => {
  if (bookedSlots >= maxSlots) return "FULL";
  if (current === "FULL") return "AVAILABLE"; // capacity opened back up
  return current;
};

interface AddDepartureInput {
  startDate: string;
  maxSlots: number;
  status?: DepartureStatus;
}

// POST /agencies/packages/:id/dates
export const addDepartureDateService = async (
  agencyId: string,
  packageId: string,
  data: AddDepartureInput
) => {
  const { startDate } = validateDepartureDateInput(data);
  await assertPackageOwned(agencyId, packageId);

  return db.trekDepartureDate.create({
    data: {
      packageId,
      startDate,
      maxSlots: data.maxSlots,
      bookedSlots: 0,
      // A brand-new date with 0 booked seats can't be FULL; honour an explicit
      // GUARANTEED, otherwise default to AVAILABLE.
      status: data.status === "GUARANTEED" ? "GUARANTEED" : "AVAILABLE",
    },
  });
};

interface UpdateDepartureInput {
  startDate?: string;
  maxSlots?: number;
  status?: DepartureStatus;
}

// PATCH /agencies/packages/:id/dates/:dateId — update status and/or slot count.
export const updateDepartureDateService = async (
  agencyId: string,
  packageId: string,
  dateId: string,
  data: UpdateDepartureInput
) => {
  const { startDate } = validateDepartureUpdateInput(data);
  await assertPackageOwned(agencyId, packageId);
  const departure = await getOwnedDeparture(packageId, dateId);

  const updateData: Prisma.TrekDepartureDateUpdateInput = {};
  if (startDate !== undefined) updateData.startDate = startDate;

  // maxSlots can never drop below seats already sold, or we'd retroactively
  // overbook confirmed trekkers.
  const nextMax = data.maxSlots ?? departure.maxSlots;
  if (data.maxSlots !== undefined) {
    if (data.maxSlots < departure.bookedSlots) {
      throw new Error(
        `maxSlots (${data.maxSlots}) cannot be less than the ${departure.bookedSlots} slot(s) already booked`
      );
    }
    updateData.maxSlots = data.maxSlots;
  }

  // Status resolution:
  //  - if the caller set a status explicitly, respect it — but never let them
  //    mark a sold-out date as AVAILABLE/GUARANTEED (that would re-open overbooking).
  //  - otherwise derive it from the (possibly new) capacity.
  if (data.status !== undefined) {
    if (data.status !== "FULL" && departure.bookedSlots >= nextMax) {
      throw new Error("Cannot mark a fully-booked date as available");
    }
    updateData.status = data.status;
  } else {
    updateData.status = deriveStatus(departure.bookedSlots, nextMax, departure.status);
  }

  return db.trekDepartureDate.update({
    where: { id: dateId },
    data: updateData,
  });
};

// DELETE /agencies/packages/:id/dates/:dateId
export const deleteDepartureDateService = async (
  agencyId: string,
  packageId: string,
  dateId: string
) => {
  await assertPackageOwned(agencyId, packageId);
  await getOwnedDeparture(packageId, dateId);

  // Bookings carry a non-nullable departureDateId with no cascade, so a date that
  // any booking points at can't be deleted without orphaning history. Block it
  // with a clear message instead of letting Postgres throw a raw FK error.
  const bookingCount = await db.booking.count({ where: { departureDateId: dateId } });
  if (bookingCount > 0) {
    throw new Error(
      `Cannot remove a departure date that has ${bookingCount} booking(s). Mark it FULL instead.`
    );
  }

  await db.trekDepartureDate.delete({ where: { id: dateId } });
  return { success: true, message: "Departure date removed" };
};

// Called from the booking-confirmation flow (inside a transaction). Books
// `groupSize` seats against the date and flips it to FULL when it sells out.
// Re-validates capacity under the transaction so two confirmations racing for the
// last seats can't both succeed.
export const confirmSlotsForBooking = async (
  tx: Prisma.TransactionClient,
  departureDateId: string,
  groupSize: number
) => {
  const departure = await tx.trekDepartureDate.findUnique({
    where: { id: departureDateId },
  });
  if (!departure) throw notFound("Departure date no longer exists");

  if (departure.status === "FULL") {
    throw new Error("This departure date is full");
  }

  const available = departure.maxSlots - departure.bookedSlots;
  if (groupSize > available) {
    throw new Error(`Only ${available} slot(s) available — cannot confirm a group of ${groupSize}`);
  }

  const bookedSlots = departure.bookedSlots + groupSize;
  return tx.trekDepartureDate.update({
    where: { id: departureDateId },
    data: {
      bookedSlots,
      // booked_slots >= max_slots → FULL
      status: bookedSlots >= departure.maxSlots ? "FULL" : departure.status,
    },
  });
};
