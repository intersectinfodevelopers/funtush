import { tenantKey, type TenantContext } from "@funtush/shared";
export * from "./redis.js";
export * from "./db.js";

/**
 * Connection configuration for the three primary stores (Backend Guide §3):
 * PostgreSQL (relational/RLS), MongoDB (audit/GPS/SOS), Redis (sessions/queues).
 * Real clients (pg, mongodb, ioredis) are wired up in Phase 1; this is the
 * package boundary, not the implementation.
 */

/** Resolves the Redis cache key namespace for a tenant. */
export function tenantCacheNamespace(ctx: TenantContext): string {
  return tenantKey(ctx, "cache");
}
