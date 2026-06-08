import dotenv from "dotenv";

dotenv.config({ path: ".env" });
import bcrypt from "bcryptjs";
import { prisma, UserRole, RoleType } from "@funtush/database";

async function main() {
  const tiers = [
    {
      name: "FREE",
      maxStaff: 1,
      maxGuides: 2,
      monthlyPrice: 0,
      features: { marketplace: false, blog: false, ads: false }
    },
    {
      name: "SMALL",
      maxStaff: 3,
      maxGuides: 5,
      monthlyPrice: 29,
      features: { marketplace: true, blog: false, ads: false }
    },
    {
      name: "MEDIUM",
      maxStaff: 10,
      maxGuides: 20,
      monthlyPrice: 99,
      features: { marketplace: true, blog: true, ads: false }
    },
    {
      name: "LARGE",
      maxStaff: 50,
      maxGuides: 200,
      monthlyPrice: 299,
      features: { marketplace: true, blog: true, ads: true }
    }
  ];

  for (const tier of tiers) {
    await prisma.subscriptionTier.upsert({
      where: { name: tier.name },
      update: tier,
      create: tier
    });
  }

  const passwordHash = await bcrypt.hash("Test@123", 10);

  const users = [
    {
      email: "admin@funtush.com",
      role: UserRole.SUPER_ADMIN,
      roleType: RoleType.PLATFORM
    },
    {
      email: "agency@funtush.com",
      role: UserRole.AGENCY_ADMIN,
      roleType: RoleType.TENANT
    },
    {
      email: "test@auth.com",
      role: UserRole.STAFF,
      roleType: RoleType.TREKKER
    }
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        passwordHash,
        role: user.role,
        roleType: user.roleType
      },
      create: {
        email: user.email,
        passwordHash,
        role: user.role,
        roleType: user.roleType
      }
    });
  }

  const permissions = [
    { key: "USER_READ", description: "Read users" },
    { key: "USER_WRITE", description: "Write users" },
    { key: "AGENCY_READ", description: "Read agency" },
    { key: "AGENCY_WRITE", description: "Write agency" }
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: perm
    });
  }

  await prisma.agency.upsert({
    where: { email: "agency@funtush.com" },
    update: {},
    create: {
      name: "Default Agency",
      email: "agency@funtush.com",
      slug: "default-agency",
      tier: "FREE"
    }
  });

  console.log("seed completed");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });