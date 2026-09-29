import { db } from "@funtush/database";

const bad = (m: string, status = 400): never => {
  throw Object.assign(new Error(m), { status });
};

const PHONE_RE = /^[+()\d][\d\s()+.-]{6,24}$/;

function text(v: unknown, label: string, max: number, min = 0): string | null {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return bad(`${label} must be text.`);
  const t = v.trim();
  if (t.length < min || t.length > max) return bad(`${label} must be ${min}-${max} characters.`);
  if (/[<>]/.test(t)) return bad(`${label} must not contain < or >.`);
  return t;
}

function phone(v: unknown, label: string): string | null {
  const t = text(v, label, 25);
  if (t && !PHONE_RE.test(t)) return bad(`${label} doesn't look like a phone number.`);
  return t;
}

const SELECT = {
  id: true,
  fullName: true,
  phone: true,
  country: true,
  nationality: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  isEmailVerified: true,
  createdAt: true,
  user: { select: { email: true } },
} as const;

function shape(t: { id: string; fullName: string | null; phone: string | null; country: string | null; nationality: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; isEmailVerified: boolean; createdAt: Date; user: { email: string } }) {
  const { user, ...rest } = t;
  return { ...rest, email: user.email };
}

/** The signed-in trekker's OWN profile. The id always comes from the session, never from the request. */
export async function getMyTrekkerProfile(userId: string) {
  const t = await db.trekker.findUnique({ where: { userId }, select: SELECT });
  if (!t) return bad("Trekker profile not found", 404);
  return shape(t);
}

export async function updateMyTrekkerProfile(userId: string, body: Record<string, unknown>) {
  const allowed = new Set(["fullName", "phone", "country", "nationality", "emergencyContactName", "emergencyContactPhone"]);
  for (const k of Object.keys(body ?? {})) if (!allowed.has(k)) bad(`Unknown field: ${k}`);
  const data: Record<string, string | null> = {};
  if (body.fullName !== undefined) data.fullName = text(body.fullName, "Name", 100, 2);
  if (body.phone !== undefined) data.phone = phone(body.phone, "Phone");
  if (body.country !== undefined) data.country = text(body.country, "Country", 60, 2);
  if (body.nationality !== undefined) data.nationality = text(body.nationality, "Nationality", 60, 2);
  if (body.emergencyContactName !== undefined) data.emergencyContactName = text(body.emergencyContactName, "Emergency contact name", 100, 2);
  if (body.emergencyContactPhone !== undefined) data.emergencyContactPhone = phone(body.emergencyContactPhone, "Emergency contact phone");
  const existing = await db.trekker.findUnique({ where: { userId }, select: { id: true } });
  if (!existing) return bad("Trekker profile not found", 404);
  const t = await db.trekker.update({ where: { id: existing.id }, data, select: SELECT });
  return shape(t);
}
