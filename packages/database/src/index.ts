
export * from "./db";
export * from "./redis";
export * from "./mongo";
export * from "@prisma/client";

import { tenantKey, type TenantContext } from "@funtush/shared";
export * from "./models/auditLog.model.js";


export function tenantCacheNamespace(ctx: TenantContext): string {
  return tenantKey(ctx, "cache");
}