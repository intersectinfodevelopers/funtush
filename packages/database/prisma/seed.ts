import dotenv from "dotenv";

dotenv.config({ path: ".env" });
import bcrypt from "bcryptjs";
import { prisma, UserRole, RoleType } from "@funtush/database";
import { normalizeEmail } from "@funtush/shared";

// Seeds the QA accounts used by the Funtush API QA test plan (admin, agency,
// two trekkers) plus the fixtures their tests rely on. Every write is an upsert,
// so it is safe to re-run; re-running also resets these accounts' passwords.
//
// Local / test DBs:   pnpm --filter @funtush/database db:seed
// Staging (NODE_ENV=production): refuses to run unless you confirm explicitly,
// so it can never be run against a real production database by accident:
//   QA_SEED_CONFIRM=staging pnpm --filter @funtush/database db:seed
// Optional: QA_ACCOUNTS_PASSWORD overrides the shared default password.
const QA_PASSWORD = process.env.QA_ACCOUNTS_PASSWORD || "Test@123";

function assertSeedAllowed(): void {
  if (process.env.NODE_ENV === "production" && process.env.QA_SEED_CONFIRM !== "staging") {
    throw new Error(
      "Refusing to seed QA accounts with NODE_ENV=production. If this is the staging " +
        "database, re-run with QA_SEED_CONFIRM=staging.",
    );
  }
}

async function main() {
  assertSeedAllowed();

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

  const passwordHash = await bcrypt.hash(QA_PASSWORD, 10);

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

  // Capture created users by email so later seed steps (agencyStaff, etc.)
  // can reference their REAL ids instead of stale hardcoded ones.
  const usersByEmail: Record<string, Awaited<ReturnType<typeof prisma.user.upsert>>> = {};

  for (const user of users) {
    usersByEmail[user.email] = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        passwordHash,
        role: user.role,
        roleType: user.roleType
      },
      create: {
        email: user.email,
        normalizedEmail: normalizeEmail(user.email),
        passwordHash,
        role: user.role,
        roleType: user.roleType
      }
    });
  }

  const agencyAdminUser = usersByEmail["agency@funtush.com"];

  const permissions = [
    { key: "USER_READ", description: "Read users" },
    { key: "USER_WRITE", description: "Write users" },
    { key: "AGENCY_READ", description: "Read agency" },
    { key: "AGENCY_WRITE", description: "Write agency" },
    // Canonical agency-dashboard permission catalog (functional areas). Kept in
    // sync with migration 20260909190000_seed_permission_catalog and
    // apps/api/src/config/permissionCatalog.ts.
    { key: "packages", description: "Create and manage trek packages, itineraries and departure dates" },
    { key: "bookings", description: "Review, approve and manage bookings and guide assignments" },
    { key: "guides", description: "Manage guides, certifications and availability" },
    { key: "customers", description: "View customer profiles, history and notes" },
    { key: "blog", description: "Write and publish blog posts, categories and media" },
    { key: "reviews", description: "Respond to and moderate customer reviews" },
    { key: "finance", description: "View finance dashboards, invoices and payouts" },
    { key: "analytics", description: "View analytics and performance reports" },
    { key: "staff", description: "Invite staff, manage roles and permissions" },
    { key: "settings", description: "Edit agency profile, branding, widgets and site settings" }
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: perm
    });
  }

  // const freeTier =
  await prisma.subscriptionTier.upsert({
    where: { name: "FREE" },
    update: {},
    create: {
      name: "FREE",
      maxStaff: 5,
      maxGuides: 5,
      monthlyPrice: 0,
      features: {}
    }
  });

  const testAgency = await prisma.agency.upsert({
    where: { email: "agency@funtush.com" },
    update: {},
    create: {
      name: "Default Agency",
      email: "agency@funtush.com",
      slug: "default-agency",
      tier: {
        connect: {
          id: freeTierId,
        },
      },
    }
  });

  const agencyUserLink = await prisma.agencyUser.upsert({
    where: {
      agencyId_userId: {
        agencyId: testAgency.id,
        userId: agencyAdminUser.id,
      },
    },
    update: {},
    create: {
      agencyId: testAgency.id,
      userId: agencyAdminUser.id,
      role: "AGENCY_ADMIN",
    },
  });

  // explicitly, or Prisma generates a new random id every time and the
  // `where: { id: ... }` match never hits on future runs.
  await prisma.agencyStaff.upsert({
    where: { id: "10000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "10000000-0000-0000-0000-000000000001",
      agencyId: testAgency.id,
      userId: agencyUserLink.id
    }
  });

  await prisma.subscription.upsert({
    where: { id: "10000000-0000-0000-0000-000000000000" },
    update: {},
    create: {
      id: "10000000-0000-0000-0000-000000000000",
      agencyId: testAgency.id,
      tierId: freeTierId
    }
  });

  // Test package + departure date for E2E booking flow
  const testPackage = await prisma.trekPackage.upsert({
    where: { slug: "everest-base-camp-test" },
    update: { status: "PUBLISHED" },
    create: {
      agencyId: testAgency.id,
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

  const testPackage2 = await prisma.trekPackage.upsert({
    where: { slug: "abc-test" },
    update: { status: "PUBLISHED" },
    create: {
      agencyId: testAgency.id,
      title: "ABC Trek (Test)",
      slug: "abc-test", 
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

  // Upsert the user by email first and key the trekker profile on that user's
  // REAL id. (It used to look up a hardcoded userId that the created user never
  // had, so every re-run tried to create john@test.com again and crashed.)
  const johnUser = await prisma.user.upsert({
    where: { email: "john@test.com" },
    update: { passwordHash, role: UserRole.STAFF, roleType: RoleType.TREKKER },
    create: {
      email: "john@test.com",
      normalizedEmail: normalizeEmail("john@test.com"),
      passwordHash,
      role: UserRole.STAFF,
      roleType: RoleType.TREKKER,
    },
  });

  const testTrekker = await prisma.trekker.upsert({
    where: { userId: johnUser.id },
    update: {},
    create: {
      userId: johnUser.id,
      fullName: "John Doe",
      phone: "1111111111",
      country: "Nepal",
      nationality: "Nepali",
      emergencyContactName: "Jane Doe",
      emergencyContactPhone: "9800000000",
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      isActive: true,
    },
  });

  // test@auth.com is the QA plan's primary trekker (john@test.com is the second
  // one, for cross-user/IDOR tests). Trekker login needs a profile row — a bare
  // user returns 401 — so give it one, verified and active like John's.
  await prisma.trekker.upsert({
    where: { userId: usersByEmail["test@auth.com"].id },
    update: {},
    create: {
      userId: usersByEmail["test@auth.com"].id,
      fullName: "Test Trekker",
      phone: "2222222222",
      country: "Nepal",
      nationality: "Nepali",
      emergencyContactName: "Test Contact",
      emergencyContactPhone: "9800000001",
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      isActive: true,
    },
  });

  const testBooking = await prisma.booking.upsert({
    where: { id: "00000000-0000-0000-0000-000000000111" },
    update: {},
    create:
    {
      agencyId: testAgency.id,
      trekkerId: testTrekker.id,
      packageId: testPackage.id,
      departureDateId: departureDate.id,
      groupSize: 7,
      totalPrice: 1700,
      status: "CONFIRMED",
      trekkerName: "John Doe",
      trekkerEmail: "john@test.com",
      trekkerPhone: "1111111111",
    },

  });

  const testReview = await prisma.review.upsert({
    where: { id: "00000000-0000-0000-0000-000000000222" },
    update: {},
    create:
    {
      agencyId: testAgency.id,
      bookingId: testBooking.id,
      trekkerId: testTrekker.id,
      assignedGuideId: "00000000-0000-0000-0000-000000000221",
      rating: 4,
      text: "Had a great time.",
      photos: [],
    },

  });

  console.log("seed completed");
  console.log("Test package ID:", testPackage.id);
  console.log("Test departure date ID:", departureDate.id);
  console.log("Test agency ID:", testPackage.agencyId);
  console.log("Test bookings ID:", testBooking.id);
  console.log("Test Review ID:", testReview.id);
}


// process.exit: importing @funtush/database also opens Redis/Mongo connections
// that keep the event loop alive, so without it this script never returns
// (which hangs `docker exec ... db:seed` on a server).
main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });


// Seeded accounts (password: Test@123 unless QA_ACCOUNTS_PASSWORD is set):
//   admin@funtush.com  SUPER_ADMIN   POST /auth/admin/login
//   agency@funtush.com AGENCY_ADMIN  POST /auth/agency/login
//   test@auth.com      trekker       POST /auth/trekker/login
//   john@test.com      trekker       POST /auth/trekker/login
