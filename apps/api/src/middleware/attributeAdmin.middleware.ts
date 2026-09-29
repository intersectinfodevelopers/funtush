import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "@funtush/auth";

/**
 * Best-effort attribution for /admin routes that are gated by the IP allow-list
 * rather than a bearer token. Those handlers write audit-log entries with
 * `actor_id = req.user?.userId ?? "unknown-admin"`, so without this an admin's
 * tier change / status change / agency view was logged as "unknown-admin" even
 * though the admin app always sends its token.
 *
 * It NEVER rejects and grants nothing: a missing or invalid token just leaves
 * `req.user` unset. Routes that need real authentication still run `requireAuth`
 * (which re-verifies the token itself) and role checks.
 */
export function attributeAdmin(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!req.user && header?.startsWith("Bearer ")) {
    try {
      req.user = verifyAccessToken(header.slice(7)) as Request["user"];
    } catch {
      /* invalid/expired token: stay anonymous */
    }
  }
  next();
}
