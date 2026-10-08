import { db } from "@funtush/database";
import { fieldError } from "../utils/httpError";
import { validatePackageInput, parsePackagePhotos, parsePackageDetails, normalizeDifficulty, DIFFICULTY_MESSAGE } from "../utils/validator";
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
  photos?: string[];
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
      ...(data.photos !== undefined ? { photos: parsePackagePhotos(data.photos) } : {}),
      ...parsePackageDetails(data as unknown as Record<string, unknown>),
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
  photos?: string[];
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
  if (data.difficulty !== undefined) {
    const difficulty = normalizeDifficulty(data.difficulty);
    if (!difficulty) throw fieldError("difficulty", DIFFICULTY_MESSAGE);
    updateData.difficulty = difficulty;
  }
  if (data.maxGroupSize !== undefined) updateData.maxGroupSize = data.maxGroupSize;
  if (data.photos !== undefined) {
    updateData.photos = parsePackagePhotos(data.photos);
    if ((updateData.photos as string[]).length === 0) {
      const cur = await db.trekPackage.findFirst({ where: { id: packageId, agencyId }, select: { status: true } });
      if (cur?.status === "PUBLISHED") throw fieldError("photos", "A published package needs at least one photo.");
    }
  }
  Object.assign(updateData, parsePackageDetails(data as unknown as Record<string, unknown>));
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

export type PackageSort = "newest" | "oldest" | "price_asc" | "price_desc" | "duration" | "duration_desc" | "title_asc" | "title_desc";

const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/**
 * A package has one departure date; once that day is behind us the package is finished, so it moves to Archived
 * (off the site and marketplace, bookings kept). Runs hourly and, for the agency being looked at, on every list.
 */
export const archiveCompletedPackages = async (agencyId?: string): Promise<number> => {
  const where = {
    ...(agencyId ? { agencyId } : {}),
    status: { in: ["DRAFT", "PUBLISHED"] as ("DRAFT" | "PUBLISHED")[] },
    departureDates: { some: {} },
    NOT: { departureDates: { some: { startDate: { gte: todayStart() } } } },
  };
  const due = await db.trekPackage.findMany({ where, select: { id: true, agencyId: true, title: true } });
  if (due.length === 0) return 0;
  await db.trekPackage.updateMany({ where: { id: { in: due.map((p) => p.id) } }, data: { status: "ARCHIVED" } });
  await db.packageActivity.createMany({
    data: due.map((p) => ({
      agencyId: p.agencyId, packageId: p.id, packageTitle: p.title, action: "ARCHIVED", actorUserId: "system", actorName: "Funtush (automatic)",
      actorRole: "SYSTEM", summary: "Archived automatically — the departure date has passed",
    })),
  });
  for (const p of due) void removePackage(p.id);
  return due.length;
};

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

export const listPackagesService = async (
  agencyId: string,
  filters: { status?: string; destination?: string; search?: string; sort?: PackageSort },
  page: { skip: number; take: number },
) => {
  await archiveCompletedPackages(agencyId).catch((e) => console.error("[archive completed]", (e as Error).message));
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

  const search = filters.search?.trim().slice(0, 100);
  if (search) {
    // Title first, but people also search by place / kind of trek.
    where.OR = ["title", "destination", "region", "category"].map((f) => ({ [f]: { contains: search, mode: "insensitive" } }));
  }

  // id tie-breaker: none of these keys is unique, and an unstable order makes
  // rows repeat/vanish across pages.
  const orderBy =
    filters.sort === "price_asc" ? [{ pricePerPerson: "asc" as const }, { id: "desc" as const }]
    : filters.sort === "price_desc" ? [{ pricePerPerson: "desc" as const }, { id: "desc" as const }]
    : filters.sort === "duration" ? [{ durationDays: "asc" as const }, { id: "desc" as const }]
    : filters.sort === "duration_desc" ? [{ durationDays: "desc" as const }, { id: "desc" as const }]
    : filters.sort === "title_asc" ? [{ title: "asc" as const }, { id: "desc" as const }]
    : filters.sort === "title_desc" ? [{ title: "desc" as const }, { id: "desc" as const }]
    : filters.sort === "oldest" ? [{ createdAt: "asc" as const }, { id: "asc" as const }]
    : [{ createdAt: "desc" as const }, { id: "desc" as const }];

  const [rows, total, groups, totalBeforeMonth] = await Promise.all([
    db.trekPackage.findMany({
      where,
      orderBy,
      skip: page.skip,
      take: page.take,
      include: {
        // The soonest upcoming departure, for the "Start date" column.
        departureDates: {
          where: { startDate: { gte: todayStart() } },
          orderBy: { startDate: "asc" },
          take: 1,
          select: { id: true, startDate: true, maxSlots: true, bookedSlots: true },
        },
      },
    }),
    db.trekPackage.count({ where }),
    // Tab counts for the whole agency, ignoring the current filter.
    db.trekPackage.groupBy({ by: ["status"], where: { agencyId }, _count: { _all: true } }),
    // How many packages the agency had when this month began — the baseline for "growth from last month".
    db.trekPackage.count({ where: { agencyId, createdAt: { lt: monthStart() } } }),
  ]);

  const data = rows.map(({ departureDates, ...pkg }) => ({ ...pkg, nextDeparture: departureDates[0] ?? null }));
  const counts: Record<string, number> = { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
  for (const g of groups) counts[g.status] = g._count._all;
  return { data, total, counts, totalBeforeMonth };
};

/**
 * One package with everything the dashboard's editor / booking form needs
 * (itinerary, departures with seat counts, add-ons, destinations). The list
 * endpoint deliberately omits these. Scoped to the caller's agency: another
 * agency's id returns null, indistinguishable from a missing one.
 */
export const getPackageDetailService = async (agencyId: string, packageId: string) => {
  return db.trekPackage.findFirst({
    where: { id: packageId, agencyId },
    include: {
      itineraries: { orderBy: { dayNumber: "asc" } },
      departureDates: { orderBy: { startDate: "asc" } },
      addOns: { orderBy: { createdAt: "asc" } },
      destinations: { select: { id: true, name: true, region: true } },
    },
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
    throw fieldError("publish", "An archived package can't be published.");
  }

  // STEP 3 — completeness checks: collect ALL problems, not just the first
  const missing: string[] = [];
  if (!pkg.title?.trim()) missing.push("title");
  if (!pkg.description?.trim()) missing.push("description");
  if (Number(pkg.pricePerPerson) <= 0) missing.push("a valid price");
  if ((pkg.photos ?? []).length === 0) missing.push("at least one photo");
  if (pkg.itineraries.length === 0) missing.push("at least one itinerary day");
  if (pkg.departureDates.length === 0) missing.push("at least one departure date");

  if (missing.length > 0) {
    throw fieldError("publish", `This package can't be published yet. Please add: ${missing.join(", ")}.`);  // → controller returns 400
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
      photos: source.photos,
      destination: source.destination,
      category: source.category,
      minDurationDays: source.minDurationDays,
      maxDurationDays: source.maxDurationDays,
      altitudeMinM: source.altitudeMinM,
      altitudeMaxM: source.altitudeMaxM,
      region: source.region,
      bestTimeToVisit: source.bestTimeToVisit,
      activities: source.activities,
      routes: source.routes,
      shortSummary: source.shortSummary,
      currency: source.currency,
      volumeDiscounts: source.volumeDiscounts as never,
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
/**
 * Permanent delete — only for an already ARCHIVED package with no bookings (bookings keep a hard reference to their
 * package, so a package that has ever been booked can only stay archived).
 */
export const deleteArchivedPackageService = async (agencyId: string, packageId: string) => {
  const pkg = await db.trekPackage.findFirst({ where: { id: packageId, agencyId }, select: { id: true, status: true } });
  if (!pkg) {
    const err = new Error("Package not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (pkg.status !== "ARCHIVED") {
    const err = new Error("Archive the package before deleting it permanently") as Error & { status?: number };
    err.status = 409;
    throw err;
  }
  if ((await db.booking.count({ where: { packageId } })) > 0) {
    const err = new Error("This package has bookings, so it can't be permanently deleted. It stays archived.") as Error & { status?: number };
    err.status = 409;
    throw err;
  }
  try {
    await db.trekPackage.deleteMany({ where: { id: packageId, agencyId } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2003") {
      const err = new Error("This package is still referenced elsewhere, so it can't be permanently deleted.") as Error & { status?: number };
      err.status = 409;
      throw err;
    }
    throw e;
  }
  void removePackage(packageId);
  return { success: true, message: "Package deleted permanently" };
};

/** PUBLISHED → DRAFT: takes the package off the site and marketplace without archiving it. */
export const unpublishPackageService = async (agencyId: string, packageId: string) => {
  const pkg = await db.trekPackage.findFirst({ where: { id: packageId, agencyId }, select: { status: true } });
  if (!pkg) {
    const err = new Error("Package not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (pkg.status !== "PUBLISHED") {
    const err = new Error("Only a published package can be unpublished") as Error & { status?: number };
    err.status = 409;
    throw err;
  }
  await db.trekPackage.update({ where: { id: packageId }, data: { status: "DRAFT" } });
  void removePackage(packageId);
  return { success: true, message: "Package unpublished" };
};

/**
 * ARCHIVED → DRAFT. The package comes back as a draft (not live) so it can be reviewed and published again.
 * A package whose single departure date has already passed can't be restored as-is — it would just be archived
 * again — so its date has to be moved first.
 */
export const restorePackageService = async (agencyId: string, packageId: string) => {
  const pkg = await db.trekPackage.findFirst({ where: { id: packageId, agencyId }, select: { status: true, departureDates: { select: { startDate: true } } } });
  if (!pkg) {
    const err = new Error("Package not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (pkg.status !== "ARCHIVED") {
    const err = new Error("Only an archived package can be restored") as Error & { status?: number };
    err.status = 409;
    throw err;
  }
  if (pkg.departureDates.length > 0 && !pkg.departureDates.some((d) => d.startDate >= todayStart())) {
    throw fieldError("restore", "This package's departure date has passed. Edit it and set a new departure date first, then restore it.");
  }
  await db.trekPackage.update({ where: { id: packageId }, data: { status: "DRAFT" } });
  return { success: true, message: "Package restored as a draft" };
};
