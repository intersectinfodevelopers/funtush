import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });


async function main() {
  // 1) Four subscription tiers (read from DB by the rest of the app).
  const tiers = [
    { name: "FREE",   maxStaff: 1,  maxGuides: 2,   monthlyPrice: 0,   features: { marketplace: false, blog: false } },
    { name: "SMALL",  maxStaff: 3,  maxGuides: 5,   monthlyPrice: 29,  features: { marketplace: true,  blog: false } },
    { name: "MEDIUM", maxStaff: 10, maxGuides: 20,  monthlyPrice: 99,  features: { marketplace: true,  blog: true  } },
    { name: "LARGE",  maxStaff: 50, maxGuides: 200, monthlyPrice: 299, features: { marketplace: true,  blog: true, ads: true } },
  ];
  for (const tier of tiers) {
    await prisma.subscriptionTier.upsert({ where: { name: tier.name }, update: tier, create: tier });
  }
  console.log(`Seeded ${tiers.length} subscription tiers`);

  // 2) Platform Super Admin (no agency).
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);
  await prisma.agencyUser.upsert({
    where: { email: "admin@funtush.com" },
    update: {},
    create: { email: "admin@funtush.com", passwordHash, role: "SUPER_ADMIN" },
  });
  console.log("Seeded Super Admin: admin@funtush.com (password: ChangeMe123!)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
