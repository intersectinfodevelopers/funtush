import { releaseIdleGuides } from "./guideAvailability.service";
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
  /** The input this message belongs to, so the dashboard can show it under that field. */
  field?: string;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

// ── input validation (same rules for create and update) ─────────────────────

const KNOWN_LANGUAGES: Record<string, string> = {
  english: "en", nepali: "ne", hindi: "hi", german: "de", french: "fr", spanish: "es", chinese: "zh", japanese: "ja",
  korean: "ko", italian: "it", russian: "ru", tibetan: "bo", sherpa: "sherpa", tamang: "tamang", gurung: "gurung", newari: "new", maithili: "mai",
};
const KNOWN_CODES = new Set(Object.values(KNOWN_LANGUAGES));

/** "English" / "english" / "EN" → `en`; anything else the agency types (e.g. "Thakali") is kept, tidied. */
export function normalizeLanguage(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  const low = t.toLowerCase();
  if (KNOWN_LANGUAGES[low]) return KNOWN_LANGUAGES[low];
  if (KNOWN_CODES.has(low)) return low;
  return t.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function cleanLanguages(v: unknown): string[] {
  if (!Array.isArray(v)) throw new ServiceError(400, "Languages must be a list.", "languages");
  if (v.length > 12) throw new ServiceError(400, "Add at most 12 languages.", "languages");
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || item.trim() === "") continue;
    if (item.trim().length > 40 || !/^[\p{L}][\p{L}\s'’-]*$/u.test(item.trim())) throw new ServiceError(400, `“${String(item).slice(0, 40)}” isn't a valid language name.`, "languages");
    const n = normalizeLanguage(item);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function httpUrl(v: unknown, field: string): string | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v !== "string") throw new ServiceError(400, "Must be a link.", field);
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    return u.toString();
  } catch {
    throw new ServiceError(400, "Must be a valid http(s) link.", field);
  }
}

function checkFields(body: { name?: unknown; phone?: unknown; email?: unknown; sex?: unknown; bio?: unknown; rating?: unknown }) {
  if (typeof body.name === "string" && body.name.trim().length > 120) throw new ServiceError(400, "Name must be at most 120 characters.", "name");
  if (typeof body.phone === "string" && body.phone.trim() && !/^[+()\d\s-]{6,25}$/.test(body.phone.trim())) throw new ServiceError(400, "Enter a valid phone number.", "phone");
  if (typeof body.email === "string" && body.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email.trim())) throw new ServiceError(400, "Enter a valid email address.", "email");
  if (typeof body.sex === "string" && body.sex.trim() && !["male", "female", "other"].includes(body.sex.trim().toLowerCase())) throw new ServiceError(400, "Choose male, female or other.", "sex");
  if (typeof body.bio === "string" && body.bio.trim().length > 1000) throw new ServiceError(400, "Bio must be at most 1000 characters.", "bio");
  if (body.rating !== undefined && body.rating !== null && !(typeof body.rating === "number" && body.rating >= 0 && body.rating <= 5)) throw new ServiceError(400, "Rating must be between 0 and 5.", "rating");
}

function checkCertifications(certs: unknown): void {
  if (certs === undefined) return;
  if (!Array.isArray(certs) || certs.length > 20) throw new ServiceError(400, "Add at most 20 certifications.", "certifications");
  certs.forEach((raw, i) => {
    const c = (raw ?? {}) as ApiCertificationInput;
    const any = [c.name, c.number, c.expiry, c.issuingBody, c.document].some((x) => typeof x === "string" && x.trim() !== "");
    if (!any) return; // an empty row is ignored
    const at = `Certification ${i + 1}: `;
    if (!(c.name ?? "").trim()) throw new ServiceError(400, `${at}enter the certification name.`, `certifications.${i}.name`);
    if ((c.name ?? "").trim().length > 120) throw new ServiceError(400, `${at}the name is too long.`, `certifications.${i}.name`);
    if (!(c.number ?? "").trim()) throw new ServiceError(400, `${at}enter the certificate number.`, `certifications.${i}.number`);
    if ((c.number ?? "").trim().length > 60) throw new ServiceError(400, `${at}the number is too long.`, `certifications.${i}.number`);
    if ((c.issuingBody ?? "").trim().length > 120) throw new ServiceError(400, `${at}the issuing body is too long.`, `certifications.${i}.issuingBody`);
    const exp = c.expiry ? new Date(c.expiry) : null;
    if (!exp || Number.isNaN(exp.getTime())) throw new ServiceError(400, `${at}enter a valid expiry date.`, `certifications.${i}.expiry`);
    httpUrl(c.document, `certifications.${i}.document`);
  });
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
  await releaseIdleGuides(agencyId); // a guide whose treks have ended shows as Available again
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));

  const where: Prisma.GuideProfileWhereInput = { agencyId, isActive: true };

  if (query.status && query.status !== "all") {
    const s = query.status.toLowerCase() as ApiStatus;
    if (STATUS_TO_DB[s]) where.status = STATUS_TO_DB[s];
  }
  if (query.language && query.language !== "all") {
    where.languages = { has: normalizeLanguage(query.language) };
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

  // Whole-agency numbers for the cards on the guides page (independent of the search / filters above).
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const [everyone, onTrek, available, certsExpiring, totalBeforeMonth] = await Promise.all([
    db.guideProfile.count({ where: { agencyId, isActive: true } }),
    db.guideProfile.count({ where: { agencyId, isActive: true, status: "ON_TREK" } }),
    db.guideProfile.count({ where: { agencyId, isActive: true, status: "AVAILABLE" } }),
    db.guideProfile.count({ where: { agencyId, isActive: true, certifications: { some: { expiry: { gt: new Date(), lte: soon } } } } }),
    db.guideProfile.count({ where: { agencyId, isActive: true, createdAt: { lt: monthStart } } }),
  ]);

  return { guides: rows.map((r) => toApiGuide(r as GuideRow)), total, page, limit, stats: { total: everyone, onTrek, available, certsExpiring, totalBeforeMonth } };
}

// ── create ──────────────────────────────────────────────────────────────────

export async function createGuide(agencyId: string, body: CreateGuideInput) {
  const name = (body.name ?? "").trim();
  const phone = (body.phone ?? "").trim();
  if (!name) throw new ServiceError(400, "Full name is required.", "name");
  if (!phone) throw new ServiceError(400, "Phone number is required.", "phone");
  checkFields(body);
  const languages = body.languages === undefined ? [] : cleanLanguages(body.languages);
  const photo = httpUrl(body.photo, "photo");
  checkCertifications(body.certifications);

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
      photoUrl: photo,
      bio: body.bio?.trim() || null,
      languages,
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
  checkFields(body);
  checkCertifications(body.certifications);
  if (body.name !== undefined) {
    const n = (body.name ?? "").trim();
    if (!n) throw new ServiceError(400, "Full name can't be empty.", "name");
    data.fullName = n;
  }
  if (body.phone !== undefined) {
    const p = (body.phone ?? "").trim();
    if (!p) throw new ServiceError(400, "Phone number can't be empty.", "phone");
    data.phone = p;
  }
  if (body.email !== undefined) data.email = body.email?.trim() || null;
  if (body.sex !== undefined) data.sex = body.sex?.trim() || null;
  if (body.photo !== undefined) data.photoUrl = httpUrl(body.photo, "photo");
  if (body.bio !== undefined) data.bio = body.bio?.trim() || null;
  if (body.languages !== undefined) data.languages = cleanLanguages(body.languages);
  if (body.rating !== undefined) data.rating = body.rating ?? null;
  if (body.status !== undefined) {
    data.status = STATUS_TO_DB[body.status as ApiStatus] ?? "AVAILABLE";
    data.autoBusy = false; // set by hand: the agency's word overrides the automatic "busy"
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
  // A guide who is on a trek that isn't finished can't be deleted — reassign, complete or cancel that booking first.
  const g = await db.guideProfile.findUnique({ where: { id }, select: { guideRef: true, fullName: true } });
  const open = g
    ? await db.booking.findFirst({
        where: { agencyId, assignedGuideId: g.guideRef, status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED"] } },
        select: { package: { select: { title: true } }, departureDate: { select: { startDate: true } } },
        orderBy: { departureDate: { startDate: "asc" } },
      })
    : null;
  if (g && open) {
    const when = open.departureDate?.startDate ? ` on ${open.departureDate.startDate.toISOString().slice(0, 10)}` : "";
    throw new ServiceError(409, `${g.fullName} is assigned to a trek that isn't completed yet (${open.package?.title ?? "a trek"}${when}). Complete or cancel that booking, or assign another guide, before deleting.`);
  }
  await db.guideProfile.update({ where: { id }, data: { isActive: false } });
}

export { ServiceError as GuideServiceError };
