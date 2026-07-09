import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import bcrypt from "bcryptjs";
import { prisma, UserRole, RoleType } from "@funtush/database";

async function main() {
  console.log("🌱 Starting seed...");

  // -------------------------
  // 1. Subscription Tiers
  // -------------------------
  const tiers = [
    {
      name: "FREE",
      maxStaff: 1,
      maxGuides: 2,
      monthlyPrice: 0,
      features: { marketplace: false }
    },
    {
      name: "SMALL",
      maxStaff: 3,
      maxGuides: 5,
      monthlyPrice: 29,
      features: { marketplace: true }
    },
    {
      name: "MEDIUM",
      maxStaff: 10,
      maxGuides: 20,
      monthlyPrice: 99,
      features: { marketplace: true }
    },
    {
      name: "LARGE",
      maxStaff: 50,
      maxGuides: 200,
      monthlyPrice: 299,
      features: { marketplace: true }
    }
  ];

  const tierMap: Record<string, string> = {};

  for (const tier of tiers) {
    const t = await prisma.subscriptionTier.upsert({
      where: { name: tier.name },
      update: {},
      create: tier
    });

    tierMap[tier.name] = t.id;
  }

  // -------------------------
  // 2. Users
  // -------------------------
  const passwordHash = await bcrypt.hash("Test@123", 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: "admin@funtush.com" },
    update: {},
    create: {
      email: "admin@funtush.com",
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      roleType: RoleType.PLATFORM
    }
  });

  const agencyAdminUser = await prisma.user.upsert({
    where: { email: "agency@funtush.com" },
    update: {},
    create: {
      email: "agency@funtush.com",
      passwordHash,
      role: UserRole.AGENCY_ADMIN,
      roleType: RoleType.TENANT
    }
  });

  const trekkerUser = await prisma.user.upsert({
    where: { email: "trekker@funtush.com" },
    update: {},
    create: {
      email: "trekker@funtush.com",
      passwordHash,
      role: UserRole.STAFF,
      roleType: RoleType.TREKKER
    }
  });

  // -------------------------
  // 3. Agencies
  // -------------------------
  const freeAgency = await prisma.agency.upsert({
    where: { email: "free@agency.com" },
    update: {},
    create: {
      name: "Free Agency",
      email: "free@agency.com",
      slug: "free-agency",
      tierId: tierMap.FREE
    }
  });

  const smallAgency = await prisma.agency.upsert({
    where: { email: "small@agency.com" },
    update: {},
    create: {
      name: "Small Agency",
      email: "small@agency.com",
      slug: "small-agency",
      tierId: tierMap.SMALL
    }
  });

  const mediumAgency = await prisma.agency.upsert({
    where: { email: "medium@agency.com" },
    update: {},
    create: {
      name: "Medium Agency",
      email: "medium@agency.com",
      slug: "medium-agency",
      tierId: tierMap.MEDIUM
    }
  });

  const largeAgency = await prisma.agency.upsert({
    where: { email: "large@agency.com" },
    update: {},
    create: {
      name: "Large Agency",
      email: "large@agency.com",
      slug: "large-agency",
      tierId: tierMap.LARGE
    }
  });

  // -------------------------
  // 4. AgencyUser link
  // -------------------------
  await prisma.agencyUser.upsert({
    where: {
      agencyId_userId: {
        agencyId: smallAgency.id,
        userId: agencyAdminUser.id
      }
    },
    update: {},
    create: {
      agencyId: smallAgency.id,
      userId: agencyAdminUser.id,
      role: UserRole.AGENCY_ADMIN
    }
  });

  // -------------------------
  // 5. Trekker profile
  // -------------------------
  const trekker = await prisma.trekker.upsert({
    where: { userId: trekkerUser.id },
    update: {},
    create: {
      userId: trekkerUser.id,
      fullName: "Test Trekker"
    }
  });

  // -------------------------
  // 6. Trek Packages
  // -------------------------
  const pkg = await prisma.trekPackage.upsert({
    where: { slug: "everest-base-test" },
    update: {},
    create: {
      agencyId: largeAgency.id,
      title: "Everest Base Camp Test",
      slug: "everest-base-test",
      durationDays: 12,
      pricePerPerson: 1200,
      difficulty: "CHALLENGING",
      maxGroupSize: 10,
      status: "PUBLISHED"
    }
  });

  // -------------------------
  // 7. Departure Date
  // -------------------------
  const departure = await prisma.trekDepartureDate.upsert({
    where: { id: "seed-departure-1" },
    update: {},
    create: {
      id: "seed-departure-1",
      packageId: pkg.id,
      startDate: new Date(Date.now() + 10 * 86400000),
      maxSlots: 10,
      bookedSlots: 0,
      status: "AVAILABLE"
    }
  });
  console.log("largeAgency:", largeAgency);
  console.log("trekker:", trekker);
  console.log("testPackage:", pkg);
  console.log("departure:", departure);

  if (!largeAgency?.id) throw new Error("largeAgency not created");
  if (!trekker?.id) throw new Error("trekker not created");
  if (!pkg?.id) throw new Error("package not created");
  if (!departure?.id) throw new Error("departure not created");

  // -------------------------
  // 8. Booking (for conversion test)
  // -------------------------
  const booking = await prisma.booking.upsert({
    where: { id: "seed-booking-1" },
    update: {},
    create: {
      id: "seed-booking-1",
      agencyId: largeAgency.id,
      trekkerId: trekker.id,
      packageId: pkg.id,
      departureDateId: departure.id,
      groupSize: 2,
      totalPrice: 2400,
      status: "CONFIRMED",
      trekkerName: "Test Trekker",
      trekkerEmail: "trekker@test.com",
      trekkerPhone: "9800000000"
    }
  });

  // -------------------------
  // 9. Visibility Scores (FIXED)
  // -------------------------
  await prisma.agencyVisibilityScore.createMany({
    data: [
      {
        agencyId: largeAgency.id,
        baseScore: 100,
        qualityBonus: 20,
        finalScore: 120
      },
      {
        agencyId: mediumAgency.id,
        baseScore: 50,
        qualityBonus: 10,
        finalScore: 60
      },
      {
        agencyId: smallAgency.id,
        baseScore: 25,
        qualityBonus: 5,
        finalScore: 30
      },
      {
        agencyId: freeAgency.id,
        baseScore: 0,
        qualityBonus: 0,
        finalScore: 0
      }
    ],
    skipDuplicates: true
  });

  console.log("✅ Seed completed");
  console.log({
    superAdmin: superAdmin.email,
    agencyAdmin: agencyAdminUser.email,
    trekker: trekkerUser.email,
    agencies: {
      freeAgency: freeAgency.id,
      smallAgency: smallAgency.id,
      mediumAgency: mediumAgency.id,
      largeAgency: largeAgency.id
    },
    bookingId: booking.id
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });