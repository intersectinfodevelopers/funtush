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
    select: { id: true, tenantId: true },
  });

  if (!agency) return null;

  return {
    tenantId: agency.tenantId,
    agencyId: agency.id,
    context: "agency",
  };
}

/**
 * Resolve tenant from a fully custom domain.
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
  });

  if (!mapping?.agency) return null;

  return {
    tenantId: mapping.agency.tenantId,
    agencyId: mapping.agency.id,
    context: "agency",
  };
}