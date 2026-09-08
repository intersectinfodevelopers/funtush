# API docs (OpenAPI / Swagger)

- Spec is built in [`openapi.ts`](./openapi.ts) and served by the app:
  - `GET /docs` — Swagger UI
  - `GET /docs.json` — raw OpenAPI 3.0 document
- In production the docs are only served when `ENABLE_DOCS=true`.

## How the spec is assembled

`openapi.ts` merges two sources:

1. A hand-authored **base document** (`baseDefinition`) — security schemes, shared
   `components.schemas`, and the **core agency-dashboard paths**. This is the part
   that is complete today.
2. Anything `swagger-jsdoc` finds in `src/routes/**/*.{ts,js}` as `@openapi`
   JSDoc blocks. Add these incrementally for the routes not yet in the base doc.

## Annotation pattern for the remaining routes

Put a JSDoc block directly above the handler:

```ts
/**
 * @openapi
 * /agencies/me/coupons:
 *   get:
 *     tags: [Coupons]
 *     summary: List the agency's coupons
 *     security: [{ refreshToken: [] }]
 *     responses:
 *       200: { description: Coupons }
 *       401: { description: Unauthorized }
 */
router.get("/agencies/me/coupons", ...);
```

- `tags`, `security`, `parameters`, `requestBody`, `responses` follow the
  OpenAPI 3.0 spec.
- Reuse `#/components/schemas/Error` and add new shared shapes to
  `components.schemas` in `openapi.ts`.
- Security: `bearerAuth` = `Authorization: Bearer <JWT>`; `refreshToken` =
  `x-refresh-token` header (used by most `/agencies/me/*` routes).

## Not yet documented (Phase 2)

blog, blog categories, videos, gallery, agency destinations, site advertisements,
widgets, and the admin sub-routes beyond dashboard/agencies/kyc.
