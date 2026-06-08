import { prisma, type Trekker, type User } from "@funtush/database";
import bcrypt from "bcrypt";

export async function registerTrekker(email: string, password: string): Promise<{ user: User; trekker: Trekker }> {
  const db = prisma;
  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    throw new Error("Email already exists");
  }

  const hash = await bcrypt.hash(password, 10);

  // create the shared User record
  const user = await db.user.create({
    data: {
      email,
      passwordHash: hash,
      role: "STAFF",
      roleType: "TREKKER",
    },
  });

  // create trekker profile linked to the user
  const trekker = await db.trekker.create({
    data: {
      userId: user.id,
      isEmailVerified: false,
    },
  });

  return { user, trekker };
}