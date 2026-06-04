import { prisma } from "../packages/database/prisma";
import { cacheGet, cacheSet, TENANT_TTL } from "./redis.service";

export interface TenantInfo {
  tenantId: string;
  agencyId: string;
}

/**
 * Resolve tenant from a subdomain slug.
 * e.g. xyz.funtush.io → slug = "xyz"
 */
export async function getTenantBySubdomain(slug: string): Promise<TenantInfo | null> {
  const cacheKey = `tenant:subdomain:${slug}`;
  const cached = await cacheGet<TenantInfo>(cacheKey);
  if (cached) return cached;

  const agency = await prisma.agency.findUnique({
    where: { slug },
    select: { id: true, tenantId: true },
  });

  if (!agency) return null;

  const info: TenantInfo = { tenantId: agency.tenantId, agencyId: agency.id };
  await cacheSet(cacheKey, info, TENANT_TTL);
  return info;
}

/**
 * Resolve tenant from a fully custom domain.
 * e.g. www.custom.com → looks up domainMapping table
 */
export async function getTenantByCustomDomain(domain: string): Promise<TenantInfo | null> {
  const cacheKey = `tenant:domain:${domain}`;
  const cached = await cacheGet<TenantInfo>(cacheKey);
  if (cached) return cached;

  const mapping = await prisma.domainMapping.findUnique({
    where: { domain },
    include: { agency: { select: { id: true, tenantId: true } } },
  });

  if (!mapping?.agency) return null;

  const info: TenantInfo = {
    tenantId: mapping.agency.tenantId,
    agencyId: mapping.agency.id,
  };
  await cacheSet(cacheKey, info, TENANT_TTL);
  return info;
}
