import type { Request, Response, NextFunction } from "express";
import { checkRateLimit, SOS_PATHS } from "../services/rateLimit.service";

function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

/**
 * Rate limit middleware.
 * - SOS routes: always exempt
 * - POST /auth/agency/login: 5 per minute per IP
 * - POST /auth/trekker/register: 3 per hour per IP
 * - All other routes: 200 per minute per IP
.
 */
export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const ip     = getClientIp(req);
  const method = req.method;
  const path   = req.path;


  if (SOS_PATHS.some((sos) => path.startsWith(sos))) {
    return next();
  }

  const result = await checkRateLimit(ip, method, path);


  res.setHeader("X-RateLimit-Limit",     result.limit);
  res.setHeader("X-RateLimit-Remaining", result.remaining);
  res.setHeader("X-RateLimit-Reset",     result.resetInSec);

  if (!result.allowed) {
    res.status(429).json({
      error:      "Too Many Requests",
      retryAfter: result.resetInSec,
      message:    `Rate limit exceeded. Try again in ${result.resetInSec} seconds.`,
    });
    return;
  }

  next();
}
