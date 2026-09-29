import type { Request, Response, NextFunction } from "express";
import { cacheGet } from "../services/redis.service";
import { IMPERSONATION_ACTIVE_PREFIX } from "../services/adminAgency.service";

/**
 * The Bearer-token counterpart to the revocation check already inside
 * authenticateWithRefreshToken. requireAuth (from the *shared*
 * @funtush/auth package, used by every role platform-wide) trusts a
 * token's signature/expiry alone and has no Redis dependency — deliberately
 * not adding one there for a check that only matters to agency
 * impersonation. Route files that gate agency mutations with bare
 * requireAuth (booking.routes.ts, staff.routes.ts) add this middleware
 * right after it instead.
 *
 * A no-op for every normal request — it only does anything when the
 * decoded token carries `impersonatedBy`, which only an impersonation
 * session ever sets.
 */
export async function checkImpersonationActive(req: Request, res: Response, next: NextFunction): Promise<void> {
  const impersonatedBy = req.user?.impersonatedBy;
  if (!impersonatedBy) {
    next();
    return;
  }

  const agencyId = req.user?.agencyId;
  const active = agencyId
    ? await cacheGet<{ sessionId: string }>(`${IMPERSONATION_ACTIVE_PREFIX}${agencyId}`)
    : null;

  if (!active || active.sessionId !== req.user?.impersonationSessionId) {
    res.status(401).json({ message: "This support session has ended." });
    return;
  }

  next();
}
