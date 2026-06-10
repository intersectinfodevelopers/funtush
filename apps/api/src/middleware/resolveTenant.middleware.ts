import type { Request, Response, NextFunction } from "express";
import { getTenantBySubdomain, getTenantByCustomDomain } from "../services/tenant.service";

const ADMIN_WHITELIST = new Set(
  (process.env.ADMIN_IP_WHITELIST || "127.0.0.1,::1").split(",").map((ip) => ip.trim())
);

function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    ""
  );
}

export async function resolveTenant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const host = req.headers.host?.split(":")[0]?.toLowerCase();
    if (!host) { res.status(404).end(); return; }

    if (host === "funtush.com" || host === "www.funtush.com") {
      req.context = "platform"; req.tenantId = null; req.agencyId = null;
      return next();
    }

    if (host === "admin.funtush.com") {
      const ip = getClientIp(req);
      if (!ADMIN_WHITELIST.has(ip)) { res.status(404).end(); return; }
      req.context = "admin"; req.tenantId = null; req.agencyId = null;
      req.adminIpAllowed = true;
      return next();
    }

    if (host.endsWith(".funtush.io")) {
      const slug = host.replace(/\.funtush\.io$/, "");
      if (!slug) { res.status(404).end(); return; }
      const tenant = await getTenantBySubdomain(slug);
      if (!tenant) { res.status(404).end(); return; }
      req.context = "agency"; req.tenantId = tenant.tenantId; req.agencyId = tenant.agencyId;
      return next();
    }

    const tenant = await getTenantByCustomDomain(host);
    if (!tenant) { res.status(404).end(); return; }
    req.context = "agency"; req.tenantId = tenant.tenantId; req.agencyId = tenant.agencyId;
    return next();

  } catch (err) {
    console.error("[resolveTenant] Unexpected error:", err);
    res.status(404).end();
  }
}
