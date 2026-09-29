import type { Request } from "express";
import { db } from "@funtush/database";

export type PackageAction = "CREATED" | "UPDATED" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED" | "DELETED" | "DUPLICATED" | "RESTORED";
const MERGE_WINDOW_MS = 2 * 60_000;

interface Actor { userId: string; name: string; email: string | null; role: "OWNER" | "STAFF" | "SUPPORT" }

/** Who is making this request: the owner, a staff member, or Funtush support acting through a support session. */
export async function resolveActor(req: Request): Promise<Actor | null> {
  const u = req.user as { userId?: string; agencyId?: string; impersonatedBy?: string } | undefined;
  const agencyId = u?.agencyId ?? req.agencyId;
  if (!u?.userId || !agencyId) return null;
  if (u.impersonatedBy) return { userId: u.impersonatedBy, name: "Funtush support", email: null, role: "SUPPORT" };
  const [user, au] = await Promise.all([
    db.user.findUnique({ where: { id: u.userId }, select: { email: true } }),
    db.agencyUser.findFirst({ where: { userId: u.userId, agencyId }, select: { id: true, role: true } }),
  ]);
  if (au?.role === "AGENCY_ADMIN") return { userId: u.userId, name: user?.email ?? "Agency owner", email: user?.email ?? null, role: "OWNER" };
  const staff = au ? await db.agencyStaff.findFirst({ where: { userId: au.id, agencyId }, select: { name: true } }) : null;
  return { userId: u.userId, name: staff?.name || user?.email || "Staff member", email: user?.email ?? null, role: "STAFF" };
}

/**
 * Appends one line to the package history. Several quick edits by the same person to the same package (a builder
 * "Save" is a burst of small calls) are folded into one entry instead of spamming the feed. Never throws.
 */
export async function recordPackageActivity(
  req: Request,
  e: { packageId: string; title: string; action: PackageAction; summary?: string; parts?: string[] },
): Promise<void> {
  try {
    const agencyId = (req.user as { agencyId?: string } | undefined)?.agencyId ?? req.agencyId;
    const actor = await resolveActor(req);
    if (!agencyId || !actor) return;
    if (e.action === "UPDATED") {
      const recent = await db.packageActivity.findFirst({
        where: { agencyId, packageId: e.packageId, action: "UPDATED", actorUserId: actor.userId, updatedAt: { gte: new Date(Date.now() - MERGE_WINDOW_MS) } },
        orderBy: { updatedAt: "desc" },
      });
      if (recent) {
        const prev = ((recent.changes as { parts?: string[] } | null)?.parts ?? []) as string[];
        const parts = [...new Set([...prev, ...(e.parts ?? [])])];
        await db.packageActivity.update({ where: { id: recent.id }, data: { packageTitle: e.title, changes: { parts }, summary: `Edited: ${parts.join(", ")}` } });
        return;
      }
    }
    await db.packageActivity.create({
      data: {
        agencyId, packageId: e.packageId, packageTitle: e.title, action: e.action,
        actorUserId: actor.userId, actorName: actor.name, actorEmail: actor.email, actorRole: actor.role,
        summary: e.action === "UPDATED" && e.parts?.length ? `Edited: ${e.parts.join(", ")}` : e.summary ?? null,
        changes: e.parts ? { parts: e.parts } : undefined,
      },
    });
  } catch (err) {
    console.error("[package activity]", (err as Error).message);
  }
}

export async function listPackageActivity(agencyId: string, q: { packageId?: string; limit?: number; excludeUserId?: string }) {
  return db.packageActivity.findMany({
    where: { agencyId, ...(q.packageId ? { packageId: q.packageId } : {}), ...(q.excludeUserId ? { NOT: { actorUserId: q.excludeUserId } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(q.limit ?? 20, 1), 100),
    select: { id: true, packageId: true, packageTitle: true, action: true, actorName: true, actorEmail: true, actorRole: true, summary: true, createdAt: true, updatedAt: true },
  });
}
