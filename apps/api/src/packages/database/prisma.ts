

// @ts-ignore — Prisma 7 CJS client works fine at runtime via tsx
import PrismaClientPkg from "@prisma/client";

const PrismaClient: any =
  (PrismaClientPkg as any).PrismaClient ?? PrismaClientPkg;

const globalForPrisma = globalThis as unknown as { prisma: any };

export const prisma: any =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
