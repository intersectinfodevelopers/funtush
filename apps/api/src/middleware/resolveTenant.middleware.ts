<<<<<<< HEAD
import { prisma } from "../packages/database/prisma";
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
=======
import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { prisma } from "@funtush/database";

// Extend Express Request globally — no custom interface needed
declare global {
  namespace Express {
    interface Request {
      tenantId?: string | null;
      agencyId?: string | null;
      context?: "platform" | "agency" | "admin";
    }
  }
}

export async function resolveTenant(
  req: Request,        // ← Standard Request, not TenantRequest
>>>>>>> ed8e877
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
<<<<<<< HEAD
  
    const host = req.headers.host?.split(":")[0]?.toLowerCase();

    if (!host) {
      res.status(404).end();
      return;
    }

  
    if (host === "funtush.com" || host === "www.funtush.com") {
      req.context  = "platform";
=======
    const host = req.headers.host?.split(":")[0];

    if (!host) {
      res.status(404).json({ error: "Invalid host" });
      return;
    }

    if (host === "funtush.com") {
      req.context = "platform";
>>>>>>> ed8e877
      req.tenantId = null;
      req.agencyId = null;
      return next();
    }

<<<<<<< HEAD
    
    if (host === "admin.funtush.com") {
      const ip = getClientIp(req);
      if (!ADMIN_WHITELIST.has(ip)) {
   
        res.status(404).end();
        return;
      }
      req.context        = "admin";
      req.tenantId       = null;
      req.agencyId       = null;
      req.adminIpAllowed = true;
=======
    if (host === "admin.funtush.com") {
      req.context = "admin";
      req.tenantId = null;
      req.agencyId = null;
      return next();
    }

    const cacheKey = `tenant:${host}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      const data = JSON.parse(cached);
      req.context = "agency";
      req.tenantId = data.tenantId;
      req.agencyId = data.agencyId;
>>>>>>> ed8e877
      return next();
    }

    if (host.endsWith(".funtush.io")) {
<<<<<<< HEAD
      const slug = host.replace(/\.funtush\.io$/, "");
      if (!slug) {
        res.status(404).end();
        return;
      }

      const tenant = await getTenantBySubdomain(slug);
      if (!tenant) {
        res.status(404).end();
        return;
      }

      req.context  = "agency";
      req.tenantId = tenant.tenantId;
      req.agencyId = tenant.agencyId;
      return next();
    }

    const tenant = await getTenantByCustomDomain(host);
    if (!tenant) {
      res.status(404).end();
      return;
    }

    req.context  = "agency";
    req.tenantId = tenant.tenantId;
    req.agencyId = tenant.agencyId;
    return next();

  } catch (err) {
    console.error("[resolveTenant] Unexpected error:", err);
   
    res.status(404).end();
  }
}
=======
      const slug = host.split(".")[0];

      const agency = await prisma.agency.findUnique({
        where: { slug },
      });

      if (!agency) {
        res.status(404).json({ error: "Tenant not found" });
        return;
      }

      await redis.set(
        cacheKey,
        JSON.stringify({
          tenantId: agency.tenantId,
          agencyId: agency.id,
        }),
        "EX",
        300
      );

      req.context = "agency";
      req.tenantId = agency.tenantId;
      req.agencyId = agency.id;
      return next();
    }

    const domain = await prisma.domainMapping.findUnique({
      where: { domain: host },
      include: { agency: true },
    });

    if (domain?.agency) {
      await redis.set(
        cacheKey,
        JSON.stringify({
          tenantId: domain.agency.tenantId,
          agencyId: domain.agency.id,
        }),
        "EX",
        300
      );

      req.context = "agency";
      req.tenantId = domain.agency.tenantId;
      req.agencyId = domain.agency.id;
      return next();
    }

    res.status(404).json({ error: "Unknown domain" });
  } catch (err) {
    res.status(500).json({ error: "Tenant resolution failed" });
  }
}
>>>>>>> ed8e877
