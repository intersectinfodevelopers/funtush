import { prisma } from "@funtush/database";
import bcrypt from "bcrypt";

export async function registerTrekker(email: string, password: string) {
  const db = prisma as typeof prisma & { trekker: any };

  const existing = await db.trekker.findUnique({ where: { email } });

  if (existing) {
    throw new Error("Email already exists");
  }

  const hash = await bcrypt.hash(password, 10);

  return db.trekker.create({
    data: {
      email,
      passwordHash: hash,
      isEmailVerified: false,
    },
  });
}