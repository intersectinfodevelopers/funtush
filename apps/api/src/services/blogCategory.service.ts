import { db } from "@funtush/database";
import { fieldError, httpError } from "../utils/httpError";

/**
 * Blog categories ("Categories" page): name, unique slug, description, colour, display order, active flag.
 * Everything is scoped to the caller's agency. Deleting a category that posts still use is refused.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

interface Clean { name: string; slug: string; description: string | null; color: string; displayOrder: number; isActive: boolean }

function validate(body: Record<string, unknown>, existing?: Clean): Clean {
  const name = body.name !== undefined ? String(body.name ?? "").trim() : existing?.name ?? "";
  if (!name) throw fieldError("name", "Category name is required.");
  if (name.length > 60) throw fieldError("name", "Category name can be at most 60 characters.");

  let slug: string;
  if (body.slug !== undefined && String(body.slug ?? "").trim() !== "") slug = String(body.slug).trim().toLowerCase();
  else slug = existing && body.name === undefined ? existing.slug : slugify(name);
  if (!slug) throw fieldError("slug", "Slug is required.");
  if (!SLUG.test(slug)) throw fieldError("slug", "Slug can only use lowercase letters, numbers and single hyphens (e.g. travel-tips).");
  if (slug.length > 80) throw fieldError("slug", "Slug can be at most 80 characters.");

  const description = body.description !== undefined ? String(body.description ?? "").trim() || null : existing?.description ?? null;
  if (description && description.length > 500) throw fieldError("description", "Description can be at most 500 characters.");

  const color = body.color !== undefined ? String(body.color ?? "").trim() : existing?.color ?? "#358CBD";
  if (!HEX.test(color)) throw fieldError("color", "Colour must be a hex value like #358CBD.");

  let displayOrder = existing?.displayOrder ?? 0;
  if (body.displayOrder !== undefined && body.displayOrder !== null && body.displayOrder !== "") {
    const n = Number(body.displayOrder);
    if (!Number.isInteger(n) || n < 0 || n > 9999) throw fieldError("displayOrder", "Display order must be a whole number from 0 to 9999.");
    displayOrder = n;
  }
  const isActive = body.isActive !== undefined ? body.isActive === true || body.isActive === "true" : existing?.isActive ?? true;
  return { name, slug, description, color: color.toUpperCase(), displayOrder, isActive };
}

const SELECT = { id: true, name: true, slug: true, description: true, color: true, displayOrder: true, isActive: true, createdAt: true, updatedAt: true, _count: { select: { blogs: true } } } as const;
type Row = { id: string; name: string; slug: string; description: string | null; color: string; displayOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date; _count: { blogs: number } };
const toApi = ({ _count, ...r }: Row) => ({ ...r, postCount: _count.blogs });

async function assertUnique(agencyId: string, c: Clean, exceptId?: string) {
  const others = { agencyId, ...(exceptId ? { id: { not: exceptId } } : {}) };
  if (await db.category.findFirst({ where: { ...others, name: { equals: c.name, mode: "insensitive" } }, select: { id: true } }))
    throw Object.assign(fieldError("name", "A category with this name already exists."), { status: 409 });
  if (await db.category.findFirst({ where: { ...others, slug: c.slug }, select: { id: true } }))
    throw Object.assign(fieldError("slug", "This slug is already used by another category."), { status: 409 });
}

export async function listCategories(agencyId: string) {
  const rows = await db.category.findMany({ where: { agencyId }, select: SELECT, orderBy: { createdAt: "desc" }, take: 500 });
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const active = rows.filter((r) => r.isActive).length;
  return {
    data: rows.map(toApi),
    stats: { total: rows.length, active, inactive: rows.length - active, totalBeforeMonth: rows.filter((r) => r.createdAt < startOfMonth).length },
  };
}

export async function getCategory(agencyId: string, id: string) {
  const row = await db.category.findFirst({ where: { id, agencyId }, select: SELECT });
  if (!row) throw httpError(404, "Category not found");
  return toApi(row);
}

export async function createCategory(agencyId: string, body: Record<string, unknown>) {
  const clean = validate(body);
  await assertUnique(agencyId, clean);
  const row = await db.category.create({ data: { agencyId, ...clean }, select: SELECT });
  return toApi(row);
}

export async function updateCategory(agencyId: string, id: string, body: Record<string, unknown>) {
  const cur = await db.category.findFirst({ where: { id, agencyId } });
  if (!cur) throw httpError(404, "Category not found");
  const clean = validate(body, { name: cur.name, slug: cur.slug, description: cur.description, color: cur.color, displayOrder: cur.displayOrder, isActive: cur.isActive });
  await assertUnique(agencyId, clean, id);
  const row = await db.category.update({ where: { id }, data: clean, select: SELECT });
  return toApi(row);
}

export async function deleteCategory(agencyId: string, id: string) {
  const cur = await db.category.findFirst({ where: { id, agencyId }, select: { id: true, name: true, _count: { select: { blogs: true } } } });
  if (!cur) throw httpError(404, "Category not found");
  if (cur._count.blogs > 0)
    throw httpError(409, `“${cur.name}” is used by ${cur._count.blogs} post${cur._count.blogs === 1 ? "" : "s"}. Move or delete ${cur._count.blogs === 1 ? "it" : "them"} first, or mark the category inactive instead.`);
  await db.category.delete({ where: { id } });
  return { name: cur.name };
}
