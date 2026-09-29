import type { NextFunction, Request, Response } from "express";
import { db } from "@funtush/database";

const deny = (res: Response, message: string) => void res.status(403).json({ success: false, error: message, message });

async function permissionsOfRole(roleId: string | null | undefined, agencyId: string): Promise<Set<string>> {
  if (!roleId) return new Set();
  const role = await db.role.findFirst({ where: { id: roleId, agencyId }, select: { permissions: { select: { permissionKey: true } } } });
  return new Set((role?.permissions ?? []).map((p) => p.permissionKey));
}

/**
 * A STAFF member holding the `staff` permission may manage the team, but must not be able to promote themselves
 * or anyone else past their own level. Rules (the owner is never checked):
 *  - only grant / assign roles whose permissions are ALL ones the actor holds;
 *  - only change / deactivate / delete staff and roles that are at or below the actor's own level;
 *  - never change their own membership or their own role.
 * Mount AFTER the auth + permission checks, on staff and role routes.
 */
export async function staffDelegationGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user as { userId?: string; agencyId?: string } | undefined;
    const agencyId = user?.agencyId ?? req.agencyId;
    if (!user?.userId || !agencyId) return deny(res, "No agency context");

    // Decide from the database, not the token: the token's role claim isn't the same on every auth path.
    const au = await db.agencyUser.findFirst({ where: { userId: user.userId, agencyId }, select: { id: true, role: true } });
    if (au?.role === "AGENCY_ADMIN") return next();
    const me = au ? await db.agencyStaff.findFirst({ where: { userId: au.id, agencyId }, select: { id: true, roleId: true } }) : null;
    if (!me) return deny(res, "Forbidden");
    const mine = await permissionsOfRole(me.roleId, agencyId);
    const within = (perms: Iterable<string>) => [...perms].every((k) => mine.has(k));

    const path = req.originalUrl.split("?")[0];
    const body = (req.body ?? {}) as { roleId?: unknown; permissionKeys?: unknown };

    const roleMatch = path.match(/^\/agencies\/me\/roles\/([^/]+)/);
    if (roleMatch && roleMatch[1] !== "permissions" && (req.method === "PATCH" || req.method === "DELETE")) {
      const roleId = roleMatch[1];
      if (roleId === me.roleId) return deny(res, "You can't change your own role.");
      if (!within(await permissionsOfRole(roleId, agencyId))) return deny(res, "That role has permissions you don't have.");
      if (Array.isArray(body.permissionKeys) && !within(body.permissionKeys.filter((k): k is string => typeof k === "string"))) {
        return deny(res, "You can only grant permissions you hold yourself.");
      }
    }

    const staffMatch = path.match(/^\/agencies\/me\/staff\/([^/]+)/);
    if (staffMatch && (req.method === "PATCH" || req.method === "DELETE")) {
      if (staffMatch[1] === me.id) return deny(res, "You can't change your own membership.");
      const target = await db.agencyStaff.findFirst({ where: { id: staffMatch[1], agencyId }, select: { roleId: true } });
      if (target && !within(await permissionsOfRole(target.roleId, agencyId))) return deny(res, "That person has more access than you.");
    }

    if (typeof body.roleId === "string" && body.roleId && req.originalUrl.startsWith("/agencies/me/staff")) {
      if (!within(await permissionsOfRole(body.roleId, agencyId))) return deny(res, "You can only assign roles whose permissions you hold yourself.");
    }
    next();
  } catch (err) {
    console.error("[staff delegation]", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
