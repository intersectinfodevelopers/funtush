import type { Request, Response, NextFunction } from "express";
import { hasPlatformPermission } from "../services/platformPermissions.service";

/**
 * Drop-in replacement for `requireSuperAdminRole` wherever that was the sole
 * platform gate on a route: SUPER_ADMIN / PLATFORM_ADMIN always pass (same
 * as before), and PLATFORM_SUPPORT now passes too, but only if granted this
 * specific module's key (see `platformPermissionCatalog.ts`).
 *
 * Strict — 403s anyone whose roleType isn't PLATFORM. Do not reuse this on a
 * route also reached by TENANT-roleType users (e.g. a shared agency/admin
 * router); those need their own inline check instead (see bug.routes.ts).
 */
export function requirePlatformPermission(key: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (user.roleType !== "PLATFORM") {
      res.status(403).json({ error: "Requires platform admin privileges" });
      return;
    }
    if (user.role === "SUPER_ADMIN" || user.role === "PLATFORM_ADMIN") {
      next();
      return;
    }
    if (user.role !== "PLATFORM_SUPPORT") {
      res.status(403).json({ error: "Requires platform admin privileges" });
      return;
    }
    const allowed = await hasPlatformPermission(user.userId, key);
    if (!allowed) {
      res.status(403).json({ error: "You don't have permission to access this. Ask a platform admin." });
      return;
    }
    next();
  };
}
