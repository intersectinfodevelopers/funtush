import type { Request, Response, NextFunction } from "express";

/**
 * Baseline response hardening (what `helmet` would add, kept dependency-free).
 *
 * - nosniff: stop browsers reinterpreting a JSON/text response as HTML/script
 * - frame-ancestors none / X-Frame-Options: this API is never meant to be framed
 * - no-referrer: don't leak API URLs (which can carry ids) to third parties
 * - HSTS (production only — it's meaningless, and sticky, over plain http in dev)
 * - `Cache-Control: no-store` on any request carrying credentials, so a shared
 *   proxy/CDN can never cache one user's private response and serve it to another
 * - Swagger UI (/docs) needs inline scripts/styles, so it is exempt from the CSP
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  if (!req.path.startsWith("/docs")) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  }
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (req.headers.authorization || req.headers["x-refresh-token"]) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
}
