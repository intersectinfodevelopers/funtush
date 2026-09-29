import type { Request, Response, NextFunction } from "express";

// Signatures of a message that was never meant for a client: Prisma's
// "Invalid `x.y()` invocation in /abs/path…", raw stack frames, absolute
// filesystem paths, driver/engine names.
const INTERNALS = /invocation in|PrismaClient|Prisma\.|prisma:|node_modules|\/home\/|\/usr\/|\/var\/|\/app\/|\bat .+\(.+:\d+:\d+\)|ECONNREFUSED|ETIMEDOUT/i;

const GENERIC = "Request could not be processed";

/**
 * Many controllers answer an unexpected failure with `err.message`. For a
 * Prisma/driver error that message contains the query, the model, and the
 * absolute path of the source file — free reconnaissance for an attacker.
 *
 * This wraps `res.json` and, for any error response (4xx or 5xx), replaces a
 * message that looks like internals with a generic one, logging the original
 * server-side (with the request id) so nothing is lost for debugging. Ordinary
 * client-facing messages ("Email already exists", "Invalid phone format") do
 * not match the internals signatures and pass through untouched.
 */
export function sanitizeServerErrors(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    // Every error status, not just 5xx: controllers routinely turn an unexpected
    // Prisma/driver failure into a 400 (`res.status(400).json({ message: err.message })`),
    // and that message carries the query plus the absolute path of the source file.
    if (res.statusCode >= 400 && body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      for (const key of ["message", "error"] as const) {
        const value = b[key];
        if (typeof value === "string" && INTERNALS.test(value)) {
          console.error(`[5xx] ${req.method} ${req.originalUrl} — scrubbed from response:`, value);
          b[key] = GENERIC;
        }
      }
    }
    return originalJson(body);
  }) as typeof res.json;

  next();
}
