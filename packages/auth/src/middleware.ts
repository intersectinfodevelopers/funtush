import { verifyAccessToken } from "./jwt";
import { jwtPayload } from "./types";
import type { Request, Response, NextFunction } from "express";

// auth middleware - verify bearer token
export const requireAuth = (
  req: Request & { user?: jwtPayload },
  res: Response,
  next: NextFunction
) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = header.split(" ")[1];
    const decoded = verifyAccessToken(token);

    req.user = decoded;

    next();
  } catch (err: any) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }
};

// Role based access control
export const requireRole = (roles: string[]) => {
  return (
    req: Request & { user?: jwtPayload },
    res: Response,
    next: NextFunction
  ) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!roles.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden: role not allowed" });
    }

    next();
  };
};


// permission based access control
export const requirePermission = (permission: string) => {
  return (
    req: Request & { user?: any },
    res: Response,
    next: NextFunction
  ) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const permissions = user.permissions ?? [];

    if (!permissions.includes(permission)) {
      return res.status(403).json({
        message: "Forbidden: missing permission",
      });
    }

    next();
  };
};

export const requireRoleType = (allowedTypes: jwtPayload["roleType"][]) => {
  return (
    req: Request & { user?: jwtPayload },
    res: Response,
    next: NextFunction
  ) => {
    const user = req.user;

    if (!user || !user.roleType) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!allowedTypes.includes(user.roleType)) {
      return res.status(403).json({
        message: "Forbidden: invalid role type",
      });
    }

    next();
  };
};