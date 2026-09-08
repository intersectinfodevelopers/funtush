import { randomUUID } from "crypto";
import { db, Prisma } from "@funtush/database";

/**
 * Guides — agency-facing CRUD.
 *
 * Backed by `GuideProfile` (grown into a first-class guide entity in Phase 2) +
 * its `GuideCertification` children. `guideRef` is the stable id that
 * `Booking.assignedGuideId` / `Payroll.guideId` / offlinePackage.loadGuideContact
 * point at; new guides get `guideRef = id`.
 *
 * API shape matches the frontend mock (funtush-frontend/data/guides.json):
 *   name (← fullName), photo (← photoUrl), status lowercased,
 *   certifications[].expiry as "YYYY-MM-DD", certifications[].document (← documentUrl).
 */

type ApiStatus = "available" | "on_trek" | "unavailable";

interface ApiCertificationInput {
  name?: string;
  issuingBody?: string | null;
  number?: string;
  expiry?: string | null;
  document?: string | null;
}

export interface CreateGuideInput {
  name?: string;
  email?: string | null;
  phone?: string;
  sex?: string | null;
  photo?: string | null;
  bio?: string | null;
  languages?: string[];
  status?: ApiStatus;
  rating?: number | null;
  certifications?: ApiCertificationInput[];
}

export type UpdateGuideInput = Partial<CreateGuideInput>;

class ServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const STATUS_TO_DB: Record<ApiStatus, "AVAILABLE" | "ON_TREK" | "UNAVAILABLE"> = {
  available: "AVAILABLE",
  on_trek: "ON_TREK",
  unavailable: "UNAVAILABLE",
};

const ACTIVE_BOOKING_STATUSES: Prisma.BookingWhereInput["status"] = {
  in: ["CONFIRMED", "PAYMENT_PENDING", "PAID", "ACTIVE"],
};

function toApiStatus(dbStatus: string): ApiStatus {
  return dbStatus.toLowerCase() as ApiStatus;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type CertRow = {
  id: string;
  name: string;
  issuingBody: string | null;
  number: string;
  expiry: Date;
  documentUrl: string | null;
};

type GuideRow = {
  id: string;
  guideRef: string;
  fullName: string;
  email: string | null;
  phone: string;
  sex: string | null;
  photoUrl: string | null;
  bio: string | null;
  languages: string[];
  status: string;
  rating: Prisma.Decimal | null;
  isActive: boolean;
  branchId: string | null;
  createdAt: Date;
  updatedAt: Date;
  certifications?: CertRow[];
};

function toApiGuide(row: GuideRow) {
  return {
    id: row.id,
    guideRef: row.guideRef,
    name: row.fullName,
    email: row.email,
    phone: row.phone,
    sex: row.sex,
    photo: row.photoUrl,
    bio: row.bio,
    languages: row.languages,
    status: toApiStatus(row.status),
    rating: row.rating === null ? null : Number(row.rating),
    branchId: row.branchId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    certifications: (row.certifications ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      issuingBody: c.issuingBody,
      number: c.number,
      expiry: ymd(c.expiry),
      document: c.documentUrl,
    })),
  };
}

function mapCertsForCreate(certs: ApiCertificationInput[] | undefined) {
  return (certs ?? [])
    .filter((c) => c && (c.name ?? "").trim() !== "" && (c.number ?? "").trim() !== "")
    .map((c) => ({
      name: (c.name ?? "").trim(),
      issuingBody: c.issuingBody?.trim() || null,
      number: (c.number ?? "").trim(),
      expiry: new Date(c.expiry ?? ""),
      documentUrl: c.document?.trim() || null,
    }));
}

const GUIDE_SELECT = {
  id: true,
  guideRef: true,
  fullName: true,
  email: true,
  phone: true,
  sex: true,
  photoUrl: true,
  bio: true,
  languages: true,
  status: true,
  rating: true,
  isActive: true,
  branchId: true,
  createdAt: true,
  updatedAt: true,
  certifications: {
    select: {
      id: true,
      name: true,
      issuingBody: true,
      number: true,
      expiry: true,
      documentUrl: true,
    },
    orderBy: { expiry: "asc" as const },
  },
} satisfies Prisma.GuideProfileSelect;

// ── list ────────────────────────────────────────────────────────────────────

export interface ListGuidesQuery {
  status?: string;
  search?: string;
  language?: string;
  page?: number;
  limit?: number;
}

export async function listGuides(agencyId: string, query: ListGuidesQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));

  const where: Prisma.GuideProfileWhereInput = { agencyId, isActive: true };

  if (query.status && query.status !== "all") {
    const s = query.status.toLowerCase() as ApiStatus;
    if (STATUS_TO_DB[s]) where.status = STATUS_TO_DB[s];
  }
  if (query.language && query.language !== "all") {
    where.languages = { has: query.language };
  }
  if (query.search?.trim()) {
    const q = query.search.trim();
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.guideProfile.findMany({
      where,
      select: GUIDE_SELECT,
      orderBy: { fullName: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.guideProfile.count({ where }),
  ]);

  return { guides: rows.map((r) => toApiGuide(r as GuideRow)), total, page, limit };
}

// ── create ──────────────────────────────────────────────────────────────────

export async function createGuide(agencyId: string, body: CreateGuideInput) {
  const name = (body.name ?? "").trim();
  const phone = (body.phone ?? "").trim();
  if (!name) throw new ServiceError(400, "Guide name is required.");
  if (!phone) throw new ServiceError(400, "Guide phone is required.");

  // Tier cap on active guides.
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { tier: { select: { maxGuides: true } } },
  });
  if (!agency) throw new ServiceError(404, "Agency not found.");
  const activeCount = await db.guideProfile.count({ where: { agencyId, isActive: true } });
  if (agency.tier && activeCount >= agency.tier.maxGuides) {
    throw new ServiceError(
      403,
      `Guide limit reached for your plan (${agency.tier.maxGuides}). Upgrade to add more guides.`,
    );
  }

  const id = randomUUID();
  const status = body.status ? STATUS_TO_DB[body.status] ?? "AVAILABLE" : "AVAILABLE";

  const row = await db.guideProfile.create({
    data: {
      id,
      guideRef: id,
      agencyId,
      fullName: name,
      phone,
      email: body.email?.trim() || null,
      sex: body.sex?.trim() || null,
      photoUrl: body.photo?.trim() || null,
      bio: body.bio?.trim() || null,
      languages: body.languages ?? [],
      status,
      rating: body.rating ?? null,
      certifications: { create: mapCertsForCreate(body.certifications) },
    },
    select: GUIDE_SELECT,
  });

  return toApiGuide(row as GuideRow);
}

// ── get one (+ computed assignments / totals) ───────────────────────────────

export async function getGuide(agencyId: string, id: string) {
  const row = await db.guideProfile.findFirst({
    where: { id, agencyId, isActive: true },
    select: GUIDE_SELECT,
  });
  if (!row) throw new ServiceError(404, "Guide not found.");

  const now = new Date();
  const [upcoming, totalTreks] = await Promise.all([
    db.booking.findMany({
      where: {
        agencyId,
        assignedGuideId: row.guideRef,
        status: ACTIVE_BOOKING_STATUSES,
        departureDate: { startDate: { gte: now } },
      },
      select: {
        id: true,
        status: true,
        departureDate: { select: { startDate: true } },
        package: { select: { title: true } },
      },
      orderBy: { departureDate: { startDate: "asc" } },
      take: 20,
    }),
    db.booking.count({
      where: { agencyId, assignedGuideId: row.guideRef, status: "COMPLETED" },
    }),
  ]);

  return {
    ...toApiGuide(row as GuideRow),
    totalTreks,
    upcomingAssignments: upcoming.map((b) => ({
      id: b.id,
      title: b.package?.title ?? null,
      date: b.departureDate?.startDate ?? null,
      status: b.status,
    })),
  };
}

// ── update ──────────────────────────────────────────────────────────────────

export async function updateGuide(agencyId: string, id: string, body: UpdateGuideInput) {
  const existing = await db.guideProfile.findFirst({
    where: { id, agencyId, isActive: true },
    select: { id: true },
  });
  if (!existing) throw new ServiceError(404, "Guide not found.");

  const data: Prisma.GuideProfileUpdateInput = {};
  if (body.name !== undefined) {
    const n = (body.name ?? "").trim();
    if (!n) throw new ServiceError(400, "Guide name cannot be empty.");
    data.fullName = n;
  }
  if (body.phone !== undefined) {
    const p = (body.phone ?? "").trim();
    if (!p) throw new ServiceError(400, "Guide phone cannot be empty.");
    data.phone = p;
  }
  if (body.email !== undefined) data.email = body.email?.trim() || null;
  if (body.sex !== undefined) data.sex = body.sex?.trim() || null;
  if (body.photo !== undefined) data.photoUrl = body.photo?.trim() || null;
  if (body.bio !== undefined) data.bio = body.bio?.trim() || null;
  if (body.languages !== undefined) data.languages = body.languages ?? [];
  if (body.rating !== undefined) data.rating = body.rating ?? null;
  if (body.status !== undefined) {
    data.status = STATUS_TO_DB[body.status as ApiStatus] ?? "AVAILABLE";
  }

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.guideProfile.update({ where: { id }, data });
    if (body.certifications !== undefined) {
      await tx.guideCertification.deleteMany({ where: { guideProfileId: id } });
      const certs = mapCertsForCreate(body.certifications);
      if (certs.length) {
        await tx.guideCertification.createMany({
          data: certs.map((c) => ({ ...c, guideProfileId: id })),
        });
      }
    }
  });

  const row = await db.guideProfile.findUnique({ where: { id }, select: GUIDE_SELECT });
  return toApiGuide(row as GuideRow);
}

// ── delete (soft) ───────────────────────────────────────────────────────────

export async function deleteGuide(agencyId: string, id: string) {
  const existing = await db.guideProfile.findFirst({
    where: { id, agencyId, isActive: true },
    select: { id: true },
  });
  if (!existing) throw new ServiceError(404, "Guide not found.");
  await db.guideProfile.update({ where: { id }, data: { isActive: false } });
}

export { ServiceError as GuideServiceError };
