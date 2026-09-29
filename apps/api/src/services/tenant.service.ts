import { db } from "@funtush/database";
import { cacheGet, cacheSet, TENANT_TTL } from "./redis.service.js";

export interface TenantInfo {
  // Agency.tenantId is nullable (only set for agencies provisioned with one);
  // the agency id is the stable scoping key when it isn't.
  tenantId: string;
  agencyId: string;
}

export async function getTenantBySubdomain(slug: string): Promise<TenantInfo | null> {
  const cacheKey = `tenant:subdomain:${slug}`;
  const cached = await cacheGet<TenantInfo>(cacheKey);
  if (cached) return cached;
  const agency = await db.agency.findUnique({
    where: { slug },
    select: { id: true, tenantId: true },
  });
  if (!agency) return null;
  const info: TenantInfo = { tenantId: agency.tenantId ?? agency.id, agencyId: agency.id };
  await cacheSet(cacheKey, info, TENANT_TTL);
  return info;
}

export async function getTenantByCustomDomain(domain: string): Promise<TenantInfo | null> {
  const cacheKey = `tenant:domain:${domain}`;
  const cached = await cacheGet<TenantInfo>(cacheKey);
  if (cached) return cached;
  // Only a VERIFIED domain resolves: PENDING means the agency has typed a
  // domain in but hasn't proven it owns it (see domain.service.ts), and
  // serving a tenant's site on an unproven domain would let anyone claim
  // someone else's hostname.
  const agency = await db.agency.findFirst({
    where: { customDomain: domain, customDomainStatus: "VERIFIED" },
    select: { id: true, tenantId: true },
  });
  if (!agency) return null;
  const info: TenantInfo = { tenantId: agency.tenantId ?? agency.id, agencyId: agency.id };
  await cacheSet(cacheKey, info, TENANT_TTL);
  return info;
}
