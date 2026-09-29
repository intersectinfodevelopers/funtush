/**
 * ── Errors that already know their HTTP status ───────────────────────────────
 *
 * Services throw; controllers translate. The problem with a plain `Error` is
 * that the controller has to *guess* which status a failure deserves, usually
 * by matching on the message text — which breaks the moment someone reword
 * a message.
 *
 * Attaching the status to the error at the point the rule is enforced keeps the
 * decision next to the reason for it, and lets every controller in the app share
 * one three-line translator:
 *
 * ```ts
 * const status = (err as { status?: number })?.status ?? 500;
 * ```
 *
 * This started life inside `offlinePackage.service.ts` (Mobile week · Day 2) and
 * was lifted here on Day 3 when a second service needed it. That file still
 * re-exports both names, so existing imports keep working.
 */

/** An `Error` that also carries the HTTP status the controller should send. */
export interface HttpError extends Error {
  status: number;
}

/**
 * Build an error the controller can turn straight into a response.
 *
 * `Object.assign`-style tagging rather than a `class extends Error` subclass:
 * subclassing `Error` needs `Object.setPrototypeOf` gymnastics to survive
 * TypeScript's downlevel compilation, and nothing here needs `instanceof`.
 */
export function httpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

/** A 400 that also says WHICH field is wrong, so the dashboard can show the message under that input. */
export interface FieldError extends HttpError {
  field: string;
}
export function fieldError(field: string, message: string): FieldError {
  const error = httpError(400, message) as FieldError;
  error.field = field;
  return error;
}
