import type { Request, Response, NextFunction } from "express";

/**
 * Rejects anything that did not pass the IP whitelist check.
 *
 * TEMP LOCAL BYPASS — remove before commit. resolveTenant middleware
 * (the thing that normally sets req.context/req.adminIpAllowed) isn't
 * wired into index.ts, and wiring it in breaks other routes due to a
 * missing DomainMapping model + an IPv6 whitelist mismatch. Flagged to
 * the team; this bypass exists only so Day 2 admin-visibility testing
 * can proceed locally.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "development" && process.env.SKIP_ADMIN_IP_CHECK === "true") {
    return next();
  }

  if (req.context !== "admin" || !req.adminIpAllowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}