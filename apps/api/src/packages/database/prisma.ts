import { prisma } from "@funtush/database";

export async function getTenantFromSlug(slug: string) {
  return prisma.tenant.findUnique({
    where: { slug },
    select: {
      tenantId: true,
      agencyId: true,
    },
  });
}


export async function getTenantFromDomain(domain: string) {
  return prisma.tenantDomain.findUnique({
    where: { domain },
    select: {
      tenantId: true,
      agencyId: true,
    },
  });
}