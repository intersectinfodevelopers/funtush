/**
 * Tenant isolation is the #1 backend rule (Backend Guide §4): every record and
 * request is scoped to a tenant, resolved at the edge before business logic
 * runs. This context is threaded through the data-access layer so no query path
 * can return cross-tenant rows.
 *
 * Super Admin is the only authorized cross-tenant actor; every access is logged.
 */
export interface TenantContext {
  tenantId: string;
  isSuperAdmin: boolean;
}

/** Builds the canonical cache/storage key prefix for a tenant. */
export function tenantKey(ctx: TenantContext, ...parts: string[]): string {
  return ["tenant", ctx.tenantId, ...parts].join(":");
}
