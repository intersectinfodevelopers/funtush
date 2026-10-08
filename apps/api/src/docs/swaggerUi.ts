/**
 * Swagger UI wiring for /docs.
 *
 * - Auto-authorize: a successful login (or token refresh) made from the page fills in the
 *   Authorize dialog — the bearer token for admin/trekker routes and `x-refresh-token`
 *   for /agencies/me/* — so testing as Super Admin or Agency Admin is "pick account → Execute →
 *   call endpoints". Logging in as the other role replaces the tokens.
 * - persistAuthorization keeps that across page reloads.
 * - Cache safety: swagger-ui-express embeds the whole spec in /docs/swagger-ui-init.js. That is
 *   a .js file, so Cloudflare caches it (for hours) and keeps serving a stale spec after a
 *   deploy. We version the script URL with a hash of the spec (new spec → new URL, so a cached
 *   copy can never be served) and mark the page and the script no-store.
 */
import { createHash } from "crypto";
import type { Express, NextFunction, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./openapi";

/** The slice of swagger-ui's response object (and `window.ui`) the interceptor touches. */
export interface SwaggerResponse {
  url?: string;
  status?: number;
  body?: unknown;
}
interface AuthPayload {
  accessToken?: string;
  refreshToken?: string;
}
interface SwaggerUiGlobal {
  ui: { authActions: { authorize: (authorized: Record<string, unknown>) => void } };
}

/**
 * Runs IN THE BROWSER: swagger-ui-express serialises it with Function#toString into
 * swagger-ui-init.js. It must therefore be self-contained plain JS — no imports, no outer
 * variables, and no named inner functions (the TS toolchain wraps those in a `__name` helper
 * that does not exist in the browser; swaggerUi.test.ts guards against that).
 */
export function autoAuthorizeInterceptor(res: SwaggerResponse): SwaggerResponse {
  try {
    const url = String(res.url || "").split("?")[0];
    if (res.status === 200 && /\/auth\/(admin\/login|agency\/login|trekker\/login|refresh)$/.test(url)) {
      let body = res.body;
      if (typeof body === "string") body = JSON.parse(body);
      const envelope = body as (AuthPayload & { data?: AuthPayload }) | null | undefined;
      const data = (envelope && envelope.data) || envelope;
      if (data && data.accessToken) {
        const authorized: Record<string, unknown> = {
          bearerAuth: {
            name: "bearerAuth",
            schema: { type: "http", scheme: "bearer", in: "header" },
            value: data.accessToken,
          },
        };
        if (data.refreshToken) {
          authorized.refreshToken = {
            name: "refreshToken",
            schema: { type: "apiKey", in: "header", name: "x-refresh-token" },
            value: data.refreshToken,
          };
        }
        (globalThis as unknown as SwaggerUiGlobal).ui.authActions.authorize(authorized);
      }
    }
  } catch (_e) {
    // never break the response the user is looking at
  }
  return res;
}

export function buildDocsHtml(): string {
  const specHash = createHash("sha1").update(JSON.stringify(openapiSpec)).digest("hex").slice(0, 10);
  return swaggerUi
    .generateHTML(openapiSpec as unknown as Parameters<typeof swaggerUi.generateHTML>[0], {
      customSiteTitle: "Funtush API",
      swaggerOptions: {
        persistAuthorization: true,
        tryItOutEnabled: true,
        displayRequestDuration: true,
        responseInterceptor: autoAuthorizeInterceptor,
      },
    })
    .replace("./swagger-ui-init.js", `./swagger-ui-init.js?v=${specHash}`);
}

export function mountSwaggerDocs(app: Express): void {
  const html = buildDocsHtml();

  app.get("/docs.json", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(openapiSpec);
  });

  app.use(
    "/docs",
    (req: Request, res: Response, next: NextFunction) => {
      if (req.path.endsWith("/swagger-ui-init.js")) res.setHeader("Cache-Control", "no-store");
      next();
    },
    swaggerUi.serve,
    (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(html);
    },
  );
}
