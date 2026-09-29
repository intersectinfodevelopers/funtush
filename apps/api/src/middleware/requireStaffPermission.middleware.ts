import type { NextFunction, Request, Response } from "express";
import { db } from "@funtush/database";
import { loadStaffAccess } from "../services/staffAccess.service";

/**
 * For Bearer-token agency routes (bookings): the owner passes; a STAFF member passes only when their role holds
 * `permission`. Any other role is refused. Mount AFTER requireAuth.
 */
export const requireStaffPermission = (permission: string) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { role?: string; userId: string; agencyId?: string } | undefined;
    if (!user) return void res.status(401).json({ message: "Unauthorized" });
    if (user.role === "AGENCY_ADMIN") return next();
    if (user.role !== "STAFF" || !user.agencyId) return void res.status(403).json({ message: "Forbidden" });
    const au = await db.agencyUser.findFirst({ where: { userId: user.userId, agencyId: user.agencyId }, select: { id: true } });
    const access = au ? await loadStaffAccess(au.id, user.agencyId) : null;
    if (!access?.active) return void res.status(401).json({ message: "Your access to this agency has been removed." });
    if (!access.permissions.has(permission)) return void res.status(403).json({ message: "You don't have permission to do that. Ask your agency admin." });
    next();
  } catch (err) {
    console.error("[staff permission]", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
