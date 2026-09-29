import type { Request, Response, NextFunction } from "express";
import { writeAuditLog } from "../services/auditLog.service";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function clientIp(req: Request): string {
  return (
    req.ip ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

/**
 * Closes the gap where only the *start* of an impersonation session was
 * logged — every individual write made during it (accept a booking, edit
 * branding, …) previously landed in the database indistinguishable from
 * the real agency admin doing it.
 *
 * Mounted once, globally, near the top of app.ts. Works regardless of
 * which auth middleware ran or where in a given route file's chain it
 * sat, because it doesn't inspect anything until `res.on("finish")` —
 * by then, whichever middleware ran has already set `req.user` if this
 * request carried an impersonation token.
 */
export function impersonationAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    const impersonatedBy = req.user?.impersonatedBy;
    if (!impersonatedBy) return;
    if (!MUTATING_METHODS.has(req.method)) return;
    if (res.statusCode >= 400) return;

    void writeAuditLog({
      action: "IMPERSONATION_ACTION",
      actor_id: impersonatedBy,
      actor_ip: clientIp(req),
      target_type: "agency",
      target_id: req.user?.agencyId ?? "unknown",
      metadata: {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        sessionId: req.user?.impersonationSessionId,
        actingAsUserId: req.user?.userId,
      },
    });
  });

  next();
}
