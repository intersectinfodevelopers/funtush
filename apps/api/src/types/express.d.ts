import { jwtPayload } from "@funtush/auth";

declare global {
  namespace Express {
    interface Request {
      user?: jwtPayload;
    }
  }
}

declare global {
  namespace Express {
    interface Request {
      tenantId?: string | null;
      agencyId?: string | null;
      context?: "platform" | "agency" | "admin";
      adminIpAllowed?: boolean;
      apiKeyAuth?: {
        agencyId: string;
        scope: "READ_ONLY" | "READ_WRITE";
        keyId: string;
      };
    }
  }
}

export { };