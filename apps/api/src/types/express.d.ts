import { PrismaClient } from "@prisma/client";

declare module "@funtush/database" {
  export const prisma: PrismaClient;
}

declare global {
  namespace Express {
    interface Request {
      tenantId?: string | null;
      agencyId?: string | null;
      context?: "platform" | "agency" | "admin";
<<<<<<< HEAD
      adminIpAllowed?: boolean;
=======
>>>>>>> ed8e877
    }
  }
}

<<<<<<< HEAD
export {};
=======
export {};
>>>>>>> ed8e877
