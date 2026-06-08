<<<<<<< HEAD
import { tenantKey, type TenantContext } from "@funtush/shared";
export * from "./redis.js";
export * from "./db.js";
=======
import { PrismaClient } from "@prisma/client";
>>>>>>> d3d6a77 (feat(auth): add trekker registration, OTP verification, and refresh-token login flow)

export const prisma = new PrismaClient();

export * from "@prisma/client";
export * from "./redis.js";