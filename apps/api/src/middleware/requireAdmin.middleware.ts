import type { Request, Response, NextFunction } from "express";

/**
 * Rejects anything that did not pass the IP whitelist check.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.context !== "admin" || !req.adminIpAllowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
