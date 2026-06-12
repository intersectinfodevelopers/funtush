import dotenv from "dotenv";
dotenv.config({ path: ".env" });
import bcrypt from "bcryptjs";
import { prisma, UserRole, RoleType } from "@funtush/database";

async function main() {
  const tiers = [
    { name: "FREE", maxStaff: 1, maxGuides: 2, monthlyPrice: 0, features: { marketplace: false, blog: false, ads: false } },
    { name: "SMALL", maxStaff: 3, maxGuides: 5, monthlyPrice: 29, features: { marketplace: true, blog: false, ads: false } },
    { name: "MEDIUM", maxStaff: 10, maxGuides: 20, monthlyPrice: 99, features: { marketplace: true, blog: true, ads: false } },
    { name: "LARGE", maxStaff: 50, maxGuides: 200, monthlyPrice: 299, features: { marketplace: true, blog: true, ads: true } }
  ];

  let freeTierId = "";

  for (const tier of tiers) {
    const createdTier = await prisma.subscriptionTier.upsert({
      where: { name: tier.name },
      update: tier,
      create: tier
    });

    if (tier.name === "FREE") {
      freeTierId = createdTier.id;
    }
  }

  const passwordHash = await bcrypt.hash("Test@123", 10);

  // Create users
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@funtush.com" },
    update: { passwordHash, role: UserRole.SUPER_ADMIN, roleType: RoleType.PLATFORM },
    create: { email: "admin@funtush.com", passwordHash, role: UserRole.SUPER_ADMIN, roleType: RoleType.PLATFORM }
  });

  const agencyUser = await prisma.user.upsert({
    where: { email: "agency@funtush.com" },
    update: { passwordHash, role: UserRole.AGENCY_ADMIN, roleType: RoleType.TENANT },
    create: { email: "agency@funtush.com", passwordHash, role: UserRole.AGENCY_ADMIN, roleType: RoleType.TENANT }
  });

  const trekkerUser = await prisma.user.upsert({
    where: { email: "test@auth.com" },
    update: { passwordHash, role: UserRole.STAFF, roleType: RoleType.TREKKER },
    create: { email: "test@auth.com", passwordHash, role: UserRole.STAFF, roleType: RoleType.TREKKER }
  });

  // Create permissions
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

  // Create agency
  const freeTier = await prisma.subscriptionTier.findUnique({ where: { name: "FREE" } });

  const agency = await prisma.agency.upsert({
    where: { email: "agency@funtush.com" },
    update: {},
    create: {
      name: "Default Agency",
      email: "agency@funtush.com",
      slug: "default-agency",
      tier: { connect: { id: freeTier!.id } }
    }
  });

  // link agency user to agency via AgencyUser
  await prisma.agencyUser.upsert({
    where: { agencyId_userId: { agencyId: agency.id, userId: agencyUser.id } },
    update: { role: UserRole.AGENCY_ADMIN },
    create: { agencyId: agency.id, userId: agencyUser.id, role: UserRole.AGENCY_ADMIN }
  });

  // Create trekker profile
  await prisma.trekker.upsert({
    where: { userId: trekkerUser.id },
    update: {},
    create: {
      userId: trekkerUser.id,
      fullName: "Test Trekker",
      phone: "9800000000",
      country: "Nepal",
      nationality: "Nepali",
      isEmailVerified: true,
      isActive: true,
      tier: { connect: { id: freeTier?.id } }
    }
  });

  // Test package + departure date for E2E booking flow 
  const testPackage = await prisma.trekPackage.upsert({
    where: { slug: "everest-base-camp-test" },
    update: { status: "PUBLISHED" },
    create: {
      agencyId: agency.id,
      title: "Everest Base Camp Trek (Test)",
      slug: "everest-base-camp-test",
      description: "Test package for E2E booking flow testing.",
      durationDays: 14,
      pricePerPerson: 1200,
      difficulty: "CHALLENGING",
      maxGroupSize: 10,
      status: "PUBLISHED",
    },
  });

  const departureDate = await prisma.trekDepartureDate.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: { bookedSlots: 0, status: "AVAILABLE" },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      packageId: testPackage.id,
      startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      maxSlots: 10,
      bookedSlots: 0,
      status: "AVAILABLE",
    },
  });

  // Itinerary days for PDF generation test
  await prisma.trekItinerary.upsert({
    where: { id: "00000000-0000-0000-0000-000000000101" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000101",
      packageId: testPackage.id,
      dayNumber: 1,
      location: "Kathmandu to Lukla to Phakding",
      description: "Fly to Lukla, trek to Phakding.",
      altitudeM: 2610,
    },
  });

  await prisma.trekItinerary.upsert({
    where: { id: "00000000-0000-0000-0000-000000000102" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000102",
      packageId: testPackage.id,
      dayNumber: 2,
      location: "Phakding to Namche Bazaar",
      description: "Trek through pine forests to Namche Bazaar.",
      altitudeM: 3440,
    },
  });

  console.log("seed completed");
  console.log("Test package ID:", testPackage.id);
  console.log("Test departure date ID:", departureDate.id);
  console.log("Test agency ID:", agency.id);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });