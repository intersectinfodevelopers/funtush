import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1. Create subscription tiers
  const tiers = await Promise.all([
    prisma.subscriptionTier.upsert({
      where: { name: "FREE" },
      update: {},
      create: {
        name: "FREE",
        maxStaff: 1,
        maxGuides: 2,
        monthlyPrice: "0",
        features: { included: ["basic"] }
      },
    }),
    prisma.subscriptionTier.upsert({
      where: { name: "SMALL" },
      update: {},
      create: {
        name: "SMALL",
        maxStaff: 5,
        maxGuides: 10,
        monthlyPrice: "99",
        features: { included: ["marketing", "support"] }
      },
    }),
    prisma.subscriptionTier.upsert({
      where: { name: "MEDIUM" },
      update: {},
      create: {
        name: "MEDIUM",
        maxStaff: 20,
        maxGuides: 50,
        monthlyPrice: "299",
        features: { included: ["marketing", "support", "analytics"] }
      },
    }),
    prisma.subscriptionTier.upsert({
      where: { name: "LARGE" },
      update: {},
      create: {
        name: "LARGE",
        maxStaff: 100,
        maxGuides: 500,
        monthlyPrice: "999",
        features: { included: ["all"] }
      },
    }),
  ]);

  console.log(" Created subscription tiers");

  // 2. Create test agencies
  const agencies = await Promise.all([
    prisma.agency.upsert({
      where: { email: "small@trek.com" },
      update: {},
      create: {
        name: "Small Trek Co",
        email: "small@trek.com",
        slug: "small-trek-co",
        tierId: tiers.find((t) => t.name === "SMALL")!.id,
      },
    }),
    prisma.agency.upsert({
      where: { email: "medium@trek.com" },
      update: {},
      create: {
        name: "Medium Adventures",
        email: "medium@trek.com",
        slug: "medium-adventures",
        tierId: tiers.find((t) => t.name === "MEDIUM")!.id,
      },
    }),
    prisma.agency.upsert({
      where: { email: "large@trek.com" },
      update: {},
      create: {
        name: "Large Expeditions",
        email: "large@trek.com",
        slug: "large-expeditions",
        tierId: tiers.find((t) => t.name === "LARGE")!.id,
      },
    }),
  ]);

  console.log(" Created 3 test agencies");
  
// 3. Create test packages (or fetch if they exist)
  const packages = await Promise.all([
    prisma.trekPackage.upsert({
      where: { slug: "everest-base-camp" },
      update: {},
      create: {
        agencyId: agencies[0].id,
        title: "Everest Base Camp Trek",
        slug: "everest-base-camp",
        description: "Amazing trek to Everest",
        durationDays: 14,
        pricePerPerson: "1500",
        maxGroupSize: 10,
        difficulty: "MODERATE",
        status: "PUBLISHED",
      },
    }),
    prisma.trekPackage.upsert({
      where: { slug: "annapurna-circuit" },
      update: {},
      create: {
        agencyId: agencies[1].id,
        title: "Annapurna Circuit Trek",
        slug: "annapurna-circuit",
        description: "Classic trek around Annapurna",
        durationDays: 21,
        pricePerPerson: "2000",
        maxGroupSize: 12,
        difficulty: "CHALLENGING",
        status: "PUBLISHED",
      },
    }),
    prisma.trekPackage.upsert({
      where: { slug: "manaslu-circuit" },
      update: {},
      create: {
        agencyId: agencies[2].id,
        title: "Manaslu Circuit Trek",
        slug: "manaslu-circuit",
        description: "Remote trek around Manaslu",
        durationDays: 18,
        pricePerPerson: "2500",
        maxGroupSize: 15,
        difficulty: "DIFFICULT",
        status: "PUBLISHED",
      },
    }),
  ]);

  console.log("Created/updated 3 test packages");

  // 4. Create a departure date for Small Trek Co's Everest package
  let departureDate;
  try {
    departureDate = await prisma.trekDepartureDate.create({
      data: {
        packageId: packages[0].id,
        startDate: new Date("2026-08-01"),
        maxSlots: 20,
        bookedSlots: 0,
      },
    });
    console.log("Created departure date");
  } catch (_e) {
    // If it exists, just fetch one
    const existing = await prisma.trekDepartureDate.findFirst({
      where: { packageId: packages[0].id },
    });
    departureDate = existing!;
    console.log(" Using existing departure date");
  }

  // 5. Create a booking linking the trekker to Small Trek Co
  try {
    const booking = await prisma.booking.create({
      data: {
        agencyId: agencies[0].id,
        trekkerId: "1770e167-5982-4363-8abe-24a37f1df9ad",
        packageId: packages[0].id,
        departureDateId: departureDate.id,
        groupSize: 4,
        totalPrice: "6000",
        status: "CONFIRMED",
        trekkerName: "Test Trekker",
        trekkerEmail: "test@trek.com",
        trekkerPhone: "555-1234",
      },
    });
    console.log("Created booking for loyalty boost test");
      console.log(`Booking ID: ${booking.id}`);

  } catch (_e) {
    console.log("Booking already exists, skipping");
  }

}

main()
  .catch((_e) => {
    console.error(_e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });