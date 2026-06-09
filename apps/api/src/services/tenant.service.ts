<<<<<<< HEAD
import { prisma } from "../packages/database/prisma";
import { cacheGet, cacheSet, TENANT_TTL } from "./redis.service";

export interface TenantInfo {
  tenantId: string;
  agencyId: string;
}

/**
 * Resolve tenant from a subdomain slug.
 */
export async function getTenantBySubdomain(slug: string): Promise<TenantInfo | null> {
  const cacheKey = `tenant:subdomain:${slug}`;
  const cached = await cacheGet<TenantInfo>(cacheKey);
  if (cached) return cached;

  const agency = await prisma.agency.findUnique({
    where: { slug },
=======
import { prisma } from "@funtush/database";

const prisma = new PrismaClient();

export interface TenantInfo {
  tenantId: string | null;
  agencyId: string | null;
  context: "central_platform" | "agency" | "platform_admin" | "unknown";
}




export async function getTenantBySubdomain(slug: string): Promise<TenantInfo | null> {
  const agency = await prisma.agency.findUnique({
    where: { subdomain: slug },
>>>>>>> ed8e877
    select: { id: true, tenantId: true },
  });

  if (!agency) return null;

<<<<<<< HEAD
  const info: TenantInfo = { tenantId: agency.tenantId, agencyId: agency.id };
  await cacheSet(cacheKey, info, TENANT_TTL);
  return info;
=======
  return {
    tenantId: agency.tenantId,
    agencyId: agency.id,
    context: "agency",
  };
>>>>>>> ed8e877
}

/**
 * Resolve tenant from a fully custom domain.
<<<<<<< HEAD

 */
export async function getTenantByCustomDomain(domain: string): Promise<TenantInfo | null> {
  const cacheKey = `tenant:domain:${domain}`;
  const cached = await cacheGet<TenantInfo>(cacheKey);
  if (cached) return cached;

  const mapping = await prisma.domainMapping.findUnique({
    where: { domain },
    include: { agency: { select: { id: true, tenantId: true } } },
=======
 *  www.custom.com → looks up custom domain mapping
 */
export async function getTenantByCustomDomain(domain: string): Promise<TenantInfo | null> {
  const mapping = await prisma.customDomain.findUnique({
    where: { domain },
    select: {
      agency: {
        select: { id: true, tenantId: true },
      },
    },
>>>>>>> ed8e877
  });

  if (!mapping?.agency) return null;

<<<<<<< HEAD
  const info: TenantInfo = {
    tenantId: mapping.agency.tenantId,
    agencyId: mapping.agency.id,
  };
  await cacheSet(cacheKey, info, TENANT_TTL);
  return info;
}
=======
  return {
    tenantId: mapping.agency.tenantId,
    agencyId: mapping.agency.id,
    context: "agency",
  };
}
>>>>>>> ed8e877
