import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { saveRequestLog } from "../services/logger.service";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = randomUUID();
  const startTime = Date.now();
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  res.setHeader("X-Request-ID", requestId);

  res.on("finish", () => {
    const responseTime = Date.now() - startTime;
    const log = {
      requestId,
      method:       req.method,
      path:         req.path,
      statusCode:   res.statusCode,
      responseTime,
      ip,
      tenantId:     req.tenantId  ?? null,
      agencyId:     req.agencyId  ?? null,
      userAgent:    req.headers["user-agent"],
      timestamp:    new Date(),
    };

    console.log(
      `[${log.timestamp.toISOString()}] ${log.method} ${log.path} → ${log.statusCode} (${responseTime}ms) [${requestId}]`
    );

    saveRequestLog(log);
  });

  next();
}