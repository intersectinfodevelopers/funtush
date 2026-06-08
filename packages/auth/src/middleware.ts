import { verifyAccessToken } from "./jwt.js";
import { jwtPayload } from "./types.js";
import type { Request, Response, NextFunction } from "express";

export type AuthRequest = Request & {
  user?: jwtPayload;
};

// auth middleware - verify bearer token
export const requireAuth = (
  req: AuthRequest,
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

    // ensure decoded token matches the AuthRequest user type
    req.user = decoded as AuthRequest["user"];

    next();
  } catch (err) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }
};

// Role based access control
export const requireRole = (roles: string[]) => {
  return (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    const user = req.user;

    if (!user) {
      console.error("Auth error: User not found");
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!roles.includes(user.role)) {
      console.error("Auth error: Role not allowed");
      return res.status(403).json({ message: "Forbidden: role not allowed" });
    }

    next();
  };
};


// permission based access control
export const requirePermission = (permission: string) => {
  return (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    const user = req.user;

    if (!user) {
      console.error("Auth error: User not found");
      return res.status(401).json({ message: "Unauthorized" });
    }

    const permissions = user.permissions ?? [];

    if (!permissions.includes(permission)) {
      console.error("Auth error: Missing permission");
      return res.status(403).json({
        message: "Forbidden: missing permission",
      });
    }

    next();
  };
};

export const requireRoleType = (allowedTypes: jwtPayload["roleType"][]) => {
  return (
    req: AuthRequest,
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