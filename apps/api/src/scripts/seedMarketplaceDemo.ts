/**
 * Marketplace demo data for QA (Marketplace module, EP-191 … EP-203).
 *
 * Why this exists: a package only shows up in the public marketplace when ALL of these hold —
 *   • its agency is status ACTIVE and on a paid tier (FREE-tier / TRIAL agencies are hidden by design),
 *   • the package is PUBLISHED, and the search index (Meilisearch) knows about it,
 *   • for GET /marketplace/agencies and compare: the agency's KYC is APPROVED.
 * The default QA agency (agency@funtush.com) is a FREE/TRIAL agency, so packages created under it are never visible —
 * and data written straight into the database is never indexed either. This script creates data that satisfies every
 * rule and then reindexes search, so "published but not visible" cannot happen.
 *
 * Creates (idempotent — safe to re-run; re-running resets these rows to the values below):
 *   • 2 marketplace-visible agencies (MEDIUM and LARGE, ACTIVE, KYC APPROVED, complete profile) → compare / ranking tests
 *   • 6 PUBLISHED packages across EASY / MODERATE / CHALLENGING / DIFFICULT with itineraries and future departures
 *     → pagination (limit=2 gives 3 pages), difficulty / price / duration / altitude filters, detail pages
 *   • 4 verified reviews (needs the QA trekkers from `pnpm --filter @funtush/database db:seed`; skipped with a warning otherwise)
 *
 *   pnpm --filter @funtush/api seed:marketplace-demo
 *   # staging (NODE_ENV=production) refuses to run unless you confirm:
 *   QA_SEED_CONFIRM=staging pnpm --filter @funtush/api seed:marketplace-demo
 *   # optional: also make the default QA agency itself marketplace-visible (SMALL tier, ACTIVE, KYC approved):
 *   PROMOTE_DEFAULT_AGENCY=1 pnpm --filter @funtush/api seed:marketplace-demo
 */
import "dotenv/config";
import { db } from "@funtush/database";
import { reindexAll } from "../services/search.service.js";

if (process.env.NODE_ENV === "production" && process.env.QA_SEED_CONFIRM !== "staging") {
  console.error(
    "Refusing to seed demo data with NODE_ENV=production. If this is the staging database, re-run with QA_SEED_CONFIRM=staging.",
  );
  process.exit(1);
}

type Difficulty = "EASY" | "MODERATE" | "CHALLENGING" | "DIFFICULT";
type DemoTier = "SMALL" | "MEDIUM" | "LARGE";

interface DemoDay {
  location: string;
  description: string;
  altitudeM: number;
}

interface DemoPackage {
  /**
   * `bestSeason` is free text and GET /marketplace/seasonal matches the current month/season WORD in it ("october",
   * "oct", "autumn"…), not date ranges — so say "Autumn", not just "Sep-Nov". June–August has no demo match.
   */
  slug: string;
  title: string;
  destination: string;
  region: string;
  difficulty: Difficulty;
  durationDays: number;
  pricePerPerson: number;
  maxGroupSize: number;
  altitudeM: number;
  bestSeason: string;
  summary: string;
  days: DemoDay[];
  /** Days from now to the (single) departure date, so it is always in the future. */
  departureInDays: number;
}

interface DemoAgency {
  key: string;
  name: string;
  email: string;
  slug: string;
  tier: DemoTier;
  priorityOverride: number;
  description: string;
  regions: string[];
  address: string;
  phone: string;
  packages: DemoPackage[];
}

const BASE_SCORE: Record<DemoTier, number> = { SMALL: 25, MEDIUM: 50, LARGE: 100 };

const AGENCIES: DemoAgency[] = [
  {
    key: "himalayan",
    name: "Himalayan Trails (Demo)",
    email: "marketplace.demo.1@funtush.test",
    slug: "himalayan-trails-demo",
    tier: "MEDIUM",
    priorityOverride: 0,
    description: "Demo agency for QA — Everest-region and Langtang treks led by local guides.",
    regions: ["Khumbu (Everest)", "Langtang"],
    address: "Thamel, Kathmandu, Nepal",
    phone: "+977-1-5550001",
    packages: [
      {
        slug: "demo-everest-base-camp",
        title: "Everest Base Camp Trek (Demo)",
        destination: "Everest Base Camp",
        region: "Khumbu",
        difficulty: "CHALLENGING",
        durationDays: 14,
        pricePerPerson: 1450,
        maxGroupSize: 12,
        altitudeM: 5364,
        bestSeason: "Spring (Mar-May) and Autumn (Sep-Nov)",
        summary: "The classic route to the foot of Mount Everest through Sherpa villages.",
        days: [
          { location: "Kathmandu to Lukla to Phakding", description: "Scenic flight to Lukla, easy walk to Phakding.", altitudeM: 2610 },
          { location: "Phakding to Namche Bazaar", description: "Cross suspension bridges and climb to the Sherpa capital.", altitudeM: 3440 },
          { location: "Namche Bazaar (acclimatisation)", description: "Rest day with a short hike to Everest View Hotel.", altitudeM: 3880 },
        ],
        departureInDays: 30,
      },
      {
        slug: "demo-langtang-valley",
        title: "Langtang Valley Trek (Demo)",
        destination: "Langtang Valley",
        region: "Langtang",
        difficulty: "MODERATE",
        durationDays: 9,
        pricePerPerson: 780,
        maxGroupSize: 10,
        altitudeM: 3870,
        bestSeason: "Spring (Mar-May) and Autumn (Oct-Nov)",
        summary: "A valley of rhododendron forest, yak pastures and Tamang culture, close to Kathmandu.",
        days: [
          { location: "Kathmandu to Syabrubesi", description: "Scenic drive to the trailhead.", altitudeM: 1550 },
          { location: "Syabrubesi to Lama Hotel", description: "Climb through forest along the Langtang river.", altitudeM: 2470 },
          { location: "Lama Hotel to Langtang Village", description: "Walk into the open upper valley.", altitudeM: 3430 },
        ],
        departureInDays: 37,
      },
      {
        slug: "demo-gokyo-lakes",
        title: "Gokyo Lakes Trek (Demo)",
        destination: "Gokyo Lakes",
        region: "Khumbu",
        difficulty: "CHALLENGING",
        durationDays: 12,
        pricePerPerson: 1250,
        maxGroupSize: 8,
        altitudeM: 5357,
        bestSeason: "Spring (Mar-May) and Autumn (Sep-Nov)",
        summary: "Turquoise glacial lakes and a sunrise view from Gokyo Ri.",
        days: [
          { location: "Kathmandu to Lukla to Phakding", description: "Scenic flight and an easy first walk.", altitudeM: 2610 },
          { location: "Phakding to Namche Bazaar", description: "Steady climb to the Sherpa capital.", altitudeM: 3440 },
          { location: "Namche Bazaar to Dole", description: "Leave the main trail toward the Gokyo valley.", altitudeM: 4040 },
        ],
        departureInDays: 44,
      },
    ],
  },
  {
    key: "annapurna",
    name: "Annapurna Adventures (Demo)",
    email: "marketplace.demo.2@funtush.test",
    slug: "annapurna-adventures-demo",
    tier: "LARGE",
    priorityOverride: 5,
    description: "Demo agency for QA — Annapurna-region treks from short sunrise hikes to the full circuit.",
    regions: ["Annapurna", "Pokhara"],
    address: "Lakeside, Pokhara, Nepal",
    phone: "+977-61-5550002",
    packages: [
      {
        slug: "demo-annapurna-circuit",
        title: "Annapurna Circuit Trek (Demo)",
        destination: "Annapurna Circuit",
        region: "Annapurna",
        difficulty: "DIFFICULT",
        durationDays: 18,
        pricePerPerson: 1900,
        maxGroupSize: 10,
        altitudeM: 5416,
        bestSeason: "Spring (Mar-May) and Autumn (Oct-Nov)",
        summary: "A full circuit around the Annapurna massif, crossing Thorong La pass.",
        days: [
          { location: "Kathmandu to Besisahar to Bhulbhule", description: "Long drive to the start of the circuit.", altitudeM: 840 },
          { location: "Bhulbhule to Jagat", description: "Follow the Marsyangdi river upstream.", altitudeM: 1300 },
          { location: "Jagat to Dharapani", description: "Cross into the upper valley.", altitudeM: 1860 },
        ],
        departureInDays: 33,
      },
      {
        slug: "demo-poon-hill",
        title: "Poon Hill Sunrise Trek (Demo)",
        destination: "Poon Hill",
        region: "Annapurna",
        difficulty: "EASY",
        durationDays: 5,
        pricePerPerson: 420,
        maxGroupSize: 14,
        altitudeM: 3210,
        bestSeason: "Winter, Spring and Autumn",
        summary: "A short, gentle trek to a famous sunrise viewpoint over Dhaulagiri and Annapurna.",
        days: [
          { location: "Pokhara to Nayapul to Tikhedhunga", description: "Drive and a gentle start through villages.", altitudeM: 1540 },
          { location: "Tikhedhunga to Ghorepani", description: "Stone-staircase climb through rhododendron forest.", altitudeM: 2860 },
          { location: "Ghorepani to Poon Hill and back", description: "Pre-dawn climb for the sunrise, then descend.", altitudeM: 3210 },
        ],
        departureInDays: 23,
      },
      {
        slug: "demo-mardi-himal",
        title: "Mardi Himal Trek (Demo)",
        destination: "Mardi Himal",
        region: "Annapurna",
        difficulty: "MODERATE",
        durationDays: 7,
        pricePerPerson: 560,
        maxGroupSize: 10,
        altitudeM: 4500,
        bestSeason: "Spring (Mar-May) and Autumn (Sep-Nov)",
        summary: "A quieter ridge trek with close views of Machapuchare.",
        days: [
          { location: "Pokhara to Kande to Forest Camp", description: "Short drive then a forest ascent.", altitudeM: 2550 },
          { location: "Forest Camp to Low Camp", description: "Steady climb along the ridge.", altitudeM: 3050 },
          { location: "Low Camp to High Camp", description: "Open ridge walking with big mountain views.", altitudeM: 3580 },
        ],
        departureInDays: 51,
      },
    ],
  },
];

/** Two QA trekkers from the main seed review each demo agency (rating differs so the average is not a round 5). */
const REVIEWERS = [
  { email: "john@test.com", rating: 5, text: "Brilliant guides and well organised. Would trek with them again." },
  { email: "test@auth.com", rating: 4, text: "Great trek and friendly team; the first day was a little rushed." },
];

const photoFor = (title: string): string => `https://placehold.co/1200x800/png?text=${encodeURIComponent(title)}`;

async function tierId(name: DemoTier): Promise<string> {
  const tier = await db.subscriptionTier.findUnique({ where: { name }, select: { id: true } });
  if (!tier) throw new Error(`Subscription tier ${name} is missing — run the main seed first (pnpm --filter @funtush/database db:seed).`);
  return tier.id;
}

async function ensureVisibleAgency(a: DemoAgency): Promise<{ id: string; firstPackageId: string; firstDepartureId: string }> {
  const tid = await tierId(a.tier);

  const agency = await db.agency.upsert({
    where: { email: a.email },
    update: { name: a.name, slug: a.slug, status: "ACTIVE", tierId: tid, priorityOverride: a.priorityOverride, publishedAt: new Date() },
    create: {
      name: a.name,
      email: a.email,
      slug: a.slug,
      status: "ACTIVE",
      tierId: tid,
      priorityOverride: a.priorityOverride,
      publishedAt: new Date(),
    },
  });

  await db.agencyProfile.upsert({
    where: { agencyId: agency.id },
    update: { description: a.description, address: a.address, phone: [a.phone], email: [a.email], regions: a.regions },
    create: { agencyId: agency.id, description: a.description, address: a.address, phone: [a.phone], email: [a.email], regions: a.regions },
  });

  await db.kycSubmission.upsert({
    where: { agencyId: agency.id },
    update: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: "marketplace-demo-seed", rejectionReason: null },
    create: { agencyId: agency.id, status: "APPROVED", reviewedAt: new Date(), reviewedBy: "marketplace-demo-seed" },
  });

  const score = BASE_SCORE[a.tier];
  await db.agencyVisibilityScore.upsert({
    where: { agencyId: agency.id },
    update: { baseScore: score, qualityBonus: 10, finalScore: score + 10 + a.priorityOverride },
    create: { agencyId: agency.id, baseScore: score, qualityBonus: 10, finalScore: score + 10 + a.priorityOverride },
  });

  if (!(await db.subscription.findFirst({ where: { agencyId: agency.id }, select: { id: true } }))) {
    await db.subscription.create({ data: { agencyId: agency.id, tierId: tid, status: "ACTIVE" } });
  }

  let firstPackageId = "";
  let firstDepartureId = "";

  for (const p of a.packages) {
    let destination = await db.trekDestination.findFirst({ where: { agencyId: agency.id, name: p.destination }, select: { id: true } });
    if (!destination) {
      destination = await db.trekDestination.create({
        data: { agencyId: agency.id, name: p.destination, region: p.region, altitudeM: p.altitudeM, bestSeason: p.bestSeason },
        select: { id: true },
      });
    }

    const fields = {
      title: p.title,
      description: p.summary,
      shortSummary: p.summary,
      durationDays: p.durationDays,
      pricePerPerson: p.pricePerPerson,
      difficulty: p.difficulty,
      maxGroupSize: p.maxGroupSize,
      photos: [photoFor(p.title)],
      status: "PUBLISHED" as const,
      destination: p.destination,
      region: p.region,
      category: "Trekking",
      currency: "USD",
      altitudeMaxM: p.altitudeM,
      bestTimeToVisit: p.bestSeason,
    };
    const pkg = await db.trekPackage.upsert({
      where: { slug: p.slug },
      update: { ...fields, destinations: { set: [{ id: destination.id }] } },
      create: { ...fields, slug: p.slug, agencyId: agency.id, destinations: { connect: [{ id: destination.id }] } },
    });

    await db.trekItinerary.deleteMany({ where: { packageId: pkg.id } });
    await db.trekItinerary.createMany({
      data: p.days.map((d, i) => ({ packageId: pkg.id, dayNumber: i + 1, location: d.location, description: d.description, altitudeM: d.altitudeM })),
    });

    let departure = await db.trekDepartureDate.findFirst({ where: { packageId: pkg.id, startDate: { gte: new Date() } }, select: { id: true } });
    if (!departure) {
      departure = await db.trekDepartureDate.create({
        data: { packageId: pkg.id, startDate: new Date(Date.now() + p.departureInDays * 86_400_000), maxSlots: 10, bookedSlots: 0, status: "AVAILABLE" },
        select: { id: true },
      });
    }

    if (!firstPackageId) {
      firstPackageId = pkg.id;
      firstDepartureId = departure.id;
    }
  }

  return { id: agency.id, firstPackageId, firstDepartureId };
}

async function ensureReviews(agencyKey: string, ids: { id: string; firstPackageId: string; firstDepartureId: string }): Promise<number> {
  let created = 0;
  for (const [i, r] of REVIEWERS.entries()) {
    const trekker = await db.trekker.findFirst({ where: { user: { email: r.email } }, select: { id: true, fullName: true } });
    if (!trekker) {
      console.warn(`  ! trekker ${r.email} not found — skipping its review (run the main seed first)`);
      continue;
    }
    const bookingId = `demo-booking-${agencyKey}-${i + 1}`;
    await db.booking.upsert({
      where: { id: bookingId },
      update: { status: "COMPLETED" },
      create: {
        id: bookingId,
        agencyId: ids.id,
        trekkerId: trekker.id,
        packageId: ids.firstPackageId,
        departureDateId: ids.firstDepartureId,
        groupSize: 2,
        totalPrice: 1000,
        status: "COMPLETED",
        trekkerName: trekker.fullName ?? "QA Trekker",
        trekkerEmail: r.email,
        trekkerPhone: "9800000000",
      },
    });
    await db.review.upsert({
      where: { bookingId },
      update: { rating: r.rating, text: r.text, verified: true },
      create: { bookingId, trekkerId: trekker.id, agencyId: ids.id, rating: r.rating, text: r.text, verified: true },
    });
    created++;
  }
  return created;
}

async function promoteDefaultAgency(): Promise<void> {
  const agency = await db.agency.findUnique({ where: { email: "agency@funtush.com" }, select: { id: true } });
  if (!agency) {
    console.warn("! PROMOTE_DEFAULT_AGENCY: agency@funtush.com has no agency yet — run the main seed first");
    return;
  }
  await db.agency.update({ where: { id: agency.id }, data: { status: "ACTIVE", tierId: await tierId("SMALL"), publishedAt: new Date() } });
  await db.kycSubmission.upsert({
    where: { agencyId: agency.id },
    update: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: "marketplace-demo-seed" },
    create: { agencyId: agency.id, status: "APPROVED", reviewedAt: new Date(), reviewedBy: "marketplace-demo-seed" },
  });
  console.log("✓ default QA agency (agency@funtush.com) promoted: SMALL tier, ACTIVE, KYC approved — its published packages are now marketplace-visible");
}

async function main(): Promise<void> {
  console.log("Seeding marketplace demo data…");
  for (const a of AGENCIES) {
    const ids = await ensureVisibleAgency(a);
    const reviews = await ensureReviews(a.key, ids);
    console.log(`✓ ${a.name} (${a.tier}) — ${a.packages.length} published packages, ${reviews} reviews`);
  }
  if (process.env.PROMOTE_DEFAULT_AGENCY === "1") await promoteDefaultAgency();

  const counts = await reindexAll();
  console.log(`✓ search reindexed: ${counts.packages} packages, ${counts.agencies} agencies`);
  if (counts.packages === 0) {
    console.warn("! 0 packages indexed — is MEILI_HOST set and Meilisearch reachable? GET /marketplace/packages will stay empty until it is.");
  }

  console.log("\nQA can now check (public, no login):");
  console.log("  GET /marketplace/packages                         → 6 packages (try ?limit=2&page=2, ?difficulty=easy, ?price_max=800)");
  console.log("  GET /marketplace/packages/demo-everest-base-camp   → package detail");
  console.log("  GET /marketplace/agencies                         → 2 verified agencies");
  console.log("  GET /marketplace/agencies/compare?slugs=himalayan-trails-demo,annapurna-adventures-demo");
  console.log("  GET /marketplace/destinations, /featured, /trending, /seasonal, /stats");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Marketplace demo seed failed:", err);
    process.exit(1);
  });
