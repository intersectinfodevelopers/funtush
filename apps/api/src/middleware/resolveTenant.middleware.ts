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
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const host = req.headers.host?.split(":")[0];

    if (!host) {
      res.status(404).json({ error: "Invalid host" });
      return;
    }

    if (host === "funtush.com") {
      req.context = "platform";
      req.tenantId = null;
      req.agencyId = null;
      return next();
    }

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
      return next();
    }

    if (host.endsWith(".funtush.io")) {
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