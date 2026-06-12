
export * from "./db";
export * from "./redis";
export * from "@prisma/client";

import { tenantKey, type TenantContext } from "@funtush/shared";
export * from "./redis.js";
export * from "./db.js";

export * from "./mongo.js";
export * from "./models/auditLog.model.js";


export function tenantCacheNamespace(ctx: TenantContext): string {
  return tenantKey(ctx, "cache");
}