/**
 * Tenant isolation is the #1 backend rule (Backend Guide Â§4): every record and
 * request is scoped to a tenant, resolved at the edge before business logic
 * runs. This context is threaded through the data-access layer so no query path
 * can return cross-tenant rows.
 *
 * A tenant context looks like: `{ tenantId: string, isSuperAdmin: boolean }`.
 * Super Admin is the only authorized cross-tenant actor; every access is logged.
 */

/**
 * Builds the canonical cache/storage key prefix for a tenant.
 *
 * @param {{ tenantId: string, isSuperAdmin: boolean }} ctx
 * @param {...string} parts
 * @returns {string}
 */
export function tenantKey(ctx, ...parts) {
  return ["tenant", ctx.tenantId, ...parts].join(":");
}
