import { db } from "@funtush/database";
import { validatePackageInput } from "../utils/validator";
import { indexPackage, indexAgency, removePackage } from "./search.service.js";

// TrekPackage.slug is @unique and required — derive it from the title and
// append a counter until it's unique within the trek_packages table.
const generatePackageSlug = async (title: string): Promise<string> => {
  const baseSlug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");

  let slug = baseSlug;
  let counter = 1;
  while (await db.trekPackage.findUnique({ where: { slug } })) {
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
  return slug;
};

interface CreatePackageInput {
  title: string;
  description?: string;
  durationDays: number;
  pricePerPerson: number;
  difficulty: "EASY" | "MODERATE" | "CHALLENGING" | "DIFFICULT";
  maxGroupSize: number;
  destinationIds?: string[]; // optional: link existing destinations (M2M)
}

export const createPackageService = async (agencyId: string, data: CreatePackageInput) => {
 // STEP 1 — validate required fields (you'll write validatePackageInput in utils/)
  validatePackageInput(data);

  // STEP 2 — write to the DB
  const pkg = await db.trekPackage.create({
    data: {
      agencyId,                          // tenant owner — from the token, NOT the body
      title: data.title,
      slug: await generatePackageSlug(data.title),
      description: data.description,
      durationDays: data.durationDays,
      pricePerPerson: data.pricePerPerson,
      difficulty: data.difficulty,
      maxGroupSize: data.maxGroupSize,
      // status omitted → defaults to DRAFT
    },
  });

  // STEP 3 — return the created row
  return pkg;
};

interface UpdatePackageInput {
  title?: string;
  description?: string;
  durationDays?: number;
  pricePerPerson?: number;
  difficulty?: "EASY" | "MODERATE" | "CHALLENGING" | "DIFFICULT";
  maxGroupSize?: number;
}

export const updatePackageService = async (
  agencyId: string,
  packageId: string,
  data: UpdatePackageInput
) => {
  // build updateData by copying only the fields that were actually provided
  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.durationDays !== undefined) updateData.durationDays = data.durationDays;
  if (data.pricePerPerson !== undefined) updateData.pricePerPerson = data.pricePerPerson;
  if (data.difficulty !== undefined) updateData.difficulty = data.difficulty;
  if (data.maxGroupSize !== undefined) updateData.maxGroupSize = data.maxGroupSize;
  // status is deliberately NOT editable here — it's driven by publish/archive endpoints

  if (Object.keys(updateData).length === 0) {
    throw new Error("No fields provided to update");
  }

  const result = await db.trekPackage.updateMany({
    where: { id: packageId, agencyId },   // ← BOTH conditions = tenant isolation
    data: updateData,
  });

  if (result.count === 0) {
    // either the package doesn't exist OR it belongs to another agency — same response
    const err = new Error("Package not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return await db.trekPackage.findUnique({ where: { id: packageId } });
};

export const listPackagesService = async (
  agencyId: string,
  filters: { status?: string; destination?: string }
) => {
  const where: Record<string, unknown> = { agencyId };   // ← always tenant-scoped

  if (filters.status) {
    // validate it's a real PackageStatus before using it, else Prisma throws an ugly error
    where.status = filters.status;
  }
  if (filters.destination) {
    // destination is a M2M relation → filter with `some`
    where.destinations = { some: { name: { equals: filters.destination, mode: "insensitive" } } };
    // (or filter by destination id if you prefer: { some: { id: filters.destination } })
  }

  return db.trekPackage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    // include: { destinations: true } if you want them in the response
  });
};

export const publishPackageService = async (agencyId: string, packageId: string) => {
  // STEP 1 — fetch the package, scoped to the tenant, WITH the relations we need to judge completeness
  const pkg = await db.trekPackage.findFirst({
    where: { id: packageId, agencyId },
    include: { itineraries: true, departureDates: true },
  });

  if (!pkg) {
    const err = new Error("Package not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  // STEP 2 (optional guard) — can't publish an archived package
  if (pkg.status === "ARCHIVED") {
    throw new Error("Cannot publish an archived package");
  }

  // STEP 3 — completeness checks: collect ALL problems, not just the first
  const missing: string[] = [];
  if (!pkg.title?.trim()) missing.push("title");
  if (!pkg.description?.trim()) missing.push("description");
  if (Number(pkg.pricePerPerson) <= 0) missing.push("a valid price");
  if (pkg.itineraries.length === 0) missing.push("at least one itinerary day");
  if (pkg.departureDates.length === 0) missing.push("at least one departure date");

  if (missing.length > 0) {
    throw new Error(`Cannot publish. Missing: ${missing.join(", ")}`);  // → controller returns 400
  }

  // STEP 4 — all checks passed → flip to PUBLISHED.
  // `where: { id }` alone is SAFE here because step 1 already proved this package belongs to the agency.
  const published = await db.trekPackage.update({
    where: { id: packageId },
    data: { status: "PUBLISHED" },
  });

  // Sync to Meilisearch so the package appears in the marketplace (Week 3 · Day 1).
  // Fire-and-forget: indexing must never block or fail the publish response.
  // The owning agency is (re)indexed too so the directory reflects its packages.
  void indexPackage(published.id);
  void indexAgency(agencyId);

  return published;
};

export const duplicatePackageService = async (agencyId: string, packageId: string) => {
  // STEP 1 — fetch the source, scoped to the tenant, including everything we'll copy
  const source = await db.trekPackage.findFirst({
    where: { id: packageId, agencyId },
    include: { itineraries: true, departureDates: true, addOns: true, destinations: true },
  });

  if (!source) {
    const err = new Error("Package not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  // STEP 2 — create the clone with Prisma nested writes (parent + all children in ONE transaction)
  const clone = await db.trekPackage.create({
    data: {
      agencyId,                              // tenant owner (the caller, from the token)
      title: `Copy of ${source.title}`,
      slug: await generatePackageSlug(`Copy of ${source.title}`),
      description: source.description,
      durationDays: source.durationDays,
      pricePerPerson: source.pricePerPerson,
      difficulty: source.difficulty,
      maxGroupSize: source.maxGroupSize,
      status: "DRAFT",                       // always a draft, even if the source was PUBLISHED

      itineraries: {
        create: source.itineraries.map((i) => ({
          dayNumber: i.dayNumber,
          location: i.location,
          description: i.description,
          altitudeM: i.altitudeM,
        })),
      },
      departureDates: {
        create: source.departureDates.map((d) => ({
          startDate: d.startDate,
          maxSlots: d.maxSlots,
          bookedSlots: 0,                    // RESET — never copy bookings into a clone
          status: "AVAILABLE",               // reset status too
        })),
      },
      addOns: {
        create: source.addOns.map((a) => ({
          name: a.name,
          price: a.price,
          perPerson: a.perPerson,
        })),
      },
      destinations: {
        connect: source.destinations.map((dest) => ({ id: dest.id })),  // connect (shared M2M), NOT create
      },
    },
    include: { itineraries: true, departureDates: true, addOns: true, destinations: true },
  });

  return clone;
};

export const archivePackageService = async (agencyId: string, packageId: string) => {
  const result = await db.trekPackage.updateMany({
    where: { id: packageId, agencyId },   // BOTH conditions = tenant isolation
    data: { status: "ARCHIVED" },
  });

  if (result.count === 0) {
    const err = new Error("Package not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  // Archived packages must disappear from the public marketplace (fire-and-forget).
  void removePackage(packageId);

  return { success: true, message: "Package archived" };
};