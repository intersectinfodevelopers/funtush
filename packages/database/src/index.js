import { tenantKey } from "@funtush/shared";

/**
 * Connection configuration for the three primary stores (Backend Guide Â§3):
 * - `postgresUrl` â PostgreSQL 16, relational/transactional data, RLS on tenant_id.
 * - `mongoUrl`    â MongoDB 7, immutable audit trail, GPS tracks, SOS records.
 * - `redisUrl`    â Redis 7, sessions, rate limits, GPS broadcast, SOS queue.
 *
 * Real clients (pg, mongodb, ioredis) are wired up in Phase 1; this is the
 * package boundary, not the implementation.
 */

/**
 * Resolves the Redis cache key namespace for a tenant.
 *
 * @param {{ tenantId: string, isSuperAdmin: boolean }} ctx
 * @returns {string}
 */
export function tenantCacheNamespace(ctx) {
  return tenantKey(ctx, "cache");
}
