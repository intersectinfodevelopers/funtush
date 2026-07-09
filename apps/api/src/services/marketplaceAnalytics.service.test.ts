import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startOfDay, subDays } from "date-fns";
import {
    recordImpression,
    recordClick,
    recordConversion,
    getAgencyMarketplaceImpressions,
    getAgencyMarketplaceConversions,
    getTopAgenciesByImpressions,
} from "./marketplaceAnalytics.service.js";
import {
    Booking,
    MarketplaceClick,
    MarketplaceImpression,
    prisma,
} from "@funtush/database";

// Mock Prisma
vi.mock("@funtush/database", () => {
    const mockPrisma = {
        marketplaceImpression: {
            upsert: vi.fn(),
            findMany: vi.fn(),
            updateMany: vi.fn(),
            groupBy: vi.fn(),
        },
        marketplaceClick: {
            create: vi.fn(),
            findMany: vi.fn(),
        },
        booking: {
            findMany: vi.fn(),
        },
        agency: {
            findUnique: vi.fn(),
        },
    };

    return {
        prisma: mockPrisma,
    };
});


describe("marketplaceAnalytics.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ──── recordImpression ────

    describe("recordImpression", () => {
        it("should create impression if it doesn't exist for today", async () => {
            const agencyId = "agency_123";
            const today = startOfDay(new Date());

            const mockImpression = {
                id: "imp_1",
                agencyId,
                date: today,
                impressionCount: 1,
                clickCount: 0,
                conversionCount: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            vi.mocked(prisma.marketplaceImpression.upsert).mockResolvedValue(mockImpression);

            const result = await recordImpression(agencyId);

            expect(prisma.marketplaceImpression.upsert).toHaveBeenCalledWith({
                where: {
                    agencyId_date: {
                        agencyId,
                        date: today,
                    },
                },
                update: {
                    impressionCount: { increment: 1 },
                },
                create: {
                    agencyId,
                    date: today,
                    impressionCount: 1,
                    clickCount: 0,
                    conversionCount: 0,
                },
            });

            expect(result.impressionCount).toBe(1);
        });

        it("should increment impression count if it already exists for today", async () => {
            const agencyId = "agency_123";
            const today = startOfDay(new Date());

            const mockImpression = {
                id: "imp_1",
                agencyId,
                date: today,
                impressionCount: 5, // Already has impressions
                clickCount: 0,
                conversionCount: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            vi.mocked(prisma.marketplaceImpression.upsert).mockResolvedValue(mockImpression);

            const result = await recordImpression(agencyId);

            expect(prisma.marketplaceImpression.upsert).toHaveBeenCalled();
            expect(result.impressionCount).toBe(5);
        });
    });

    // ──── recordClick ────

    describe("recordClick", () => {
        it("should record click for authenticated trekker", async () => {
            const agencyId = "agency_123";
            const treklerId = "trekker_456";
            const destination = "agency-profile";
            const searchQuery = "everest";
            const today = startOfDay(new Date());

            const mockClick = {
                id: "click_1",
                agencyId,
                treklerId,
                destination,
                searchQuery,
                timestamp: new Date(),
                createdAt: new Date(),
            };

            vi.mocked(prisma.marketplaceImpression.upsert).mockResolvedValue({
                id: "imp_1",
                agencyId,
                date: today,
                impressionCount: 0,
                clickCount: 1,
                conversionCount: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            } as MarketplaceImpression);

            vi.mocked(prisma.marketplaceClick.create).mockResolvedValue(
                mockClick as MarketplaceClick
            );

            const result = await recordClick(
                agencyId,
                treklerId,
                destination,
                searchQuery
            );

            expect(prisma.marketplaceImpression.upsert).toHaveBeenCalledWith({
                where: {
                    agencyId_date: {
                        agencyId,
                        date: today,
                    },
                },
                create: {
                    agencyId,
                    date: today,
                    impressionCount: 0,
                    clickCount: 1,
                },
                update: {
                    clickCount: {
                        increment: 1,
                    },
                },
            });

            expect(prisma.marketplaceClick.create).toHaveBeenCalledWith({
                data: {
                    agencyId,
                    treklerId,
                    destination,
                    searchQuery,
                },
            });

            expect(result.id).toBe("click_1");
        });

        it("should record click for anonymous trekker", async () => {
            const agencyId = "agency_123";
            const destination = "inquiry-form";
            const today = startOfDay(new Date());

            const mockClick = {
                id: "click_2",
                agencyId,
                treklerId: null,
                destination,
                searchQuery: null,
                timestamp: new Date(),
                createdAt: new Date(),
            };

            vi.mocked(prisma.marketplaceImpression.upsert).mockResolvedValue({
                id: "imp_1",
                agencyId,
                date: today,
                impressionCount: 0,
                clickCount: 1,
                conversionCount: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            } as MarketplaceImpression);

            vi.mocked(prisma.marketplaceClick.create).mockResolvedValue(
                mockClick as MarketplaceClick
            );

            const result = await recordClick(agencyId, undefined, destination);

            expect(prisma.marketplaceImpression.upsert).toHaveBeenCalled();

            expect(prisma.marketplaceClick.create).toHaveBeenCalledWith({
                data: {
                    agencyId,
                    treklerId: null,
                    destination,
                    searchQuery: null,
                },
            });

            expect(result.treklerId).toBeNull();
        });
    });
    // ──── recordConversion ────

    describe("recordConversion", () => {
        it("should increment conversion count for today", async () => {
            const agencyId = "agency_123";
            const today = startOfDay(new Date());

            vi.mocked(prisma.marketplaceImpression.updateMany).mockResolvedValue({
                count: 1,
            } as Awaited<ReturnType<typeof prisma.marketplaceImpression.updateMany>>);

            await recordConversion(agencyId);

            expect(prisma.marketplaceImpression.updateMany).toHaveBeenCalledWith({
                where: {
                    agencyId,
                    date: today,
                },
                data: {
                    conversionCount: {
                        increment: 1,
                    },
                },
            });
        });
    });

    // ──── getAgencyMarketplaceImpressions ────

    describe("getAgencyMarketplaceImpressions", () => {
        it("should calculate CTR correctly", async () => {
            const agencyId = "agency_123";
            const mockImpressions = [
                {
                    id: "imp_1",
                    agencyId,
                    date: startOfDay(new Date()),
                    impressionCount: 100,
                    clickCount: 10,
                    conversionCount: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "imp_2",
                    agencyId,
                    date: startOfDay(subDays(new Date(), 1)),
                    impressionCount: 50,
                    clickCount: 5,
                    conversionCount: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];

            vi.mocked(prisma.marketplaceImpression.findMany).mockResolvedValue(
                mockImpressions as MarketplaceImpression[]
            );

            const result = await getAgencyMarketplaceImpressions(agencyId, "last_7_days");

            expect(result.summary.totalImpressions).toBe(150);
            expect(result.summary.totalClicks).toBe(15);
            expect(result.summary.ctr).toBe("10.00%");
            expect(result.summary.totalConversions).toBe(3);
            expect(result.summary.conversionRate).toBe("20.00%");
        });

        it("should handle zero impressions gracefully", async () => {
            const agencyId = "agency_new";
            vi.mocked(prisma.marketplaceImpression.findMany).mockResolvedValue([]);

            const result = await getAgencyMarketplaceImpressions(agencyId, "last_30_days");

            expect(result.summary.totalImpressions).toBe(0);
            expect(result.summary.ctr).toBe("0.00%");
            expect(result.summary.conversionRate).toBe("0.00%");
        });

        it("should validate period parameter", async () => {
            const agencyId = "agency_123";
            vi.mocked(prisma.marketplaceImpression.findMany).mockResolvedValue([]);

            const result = await getAgencyMarketplaceImpressions(
                agencyId,
                "last_30_days"
            );

            expect(result.period).toBe("last_30_days");
            expect(prisma.marketplaceImpression.findMany).toHaveBeenCalled();
        });
    });

    // ──── getAgencyMarketplaceConversions ────

    describe("getAgencyMarketplaceConversions", () => {
        it("should link clicks to bookings within conversion window", async () => {
            const agencyId = "agency_123";
            const treklerId = "trekker_456";
            const clickTime = new Date("2025-01-10T14:00:00Z");
            const bookingTime = new Date("2025-01-10T14:30:00Z"); // 30 min after

            const mockClicks = [
                {
                    id: "click_1",
                    agencyId,
                    treklerId,
                    destination: "agency-profile",
                    searchQuery: "everest",
                    timestamp: clickTime,
                    createdAt: new Date(),
                },
            ];

            const mockBookings = [
                {
                    id: "booking_1",
                    agencyId,
                    trekkerId: treklerId,
                    status: "PENDING",
                    trekkerEmail: "trekker@example.com",
                    createdAt: bookingTime,
                },
            ];

            vi.mocked(prisma.marketplaceClick.findMany).mockResolvedValue(mockClicks as MarketplaceClick[]);
            vi.mocked(prisma.booking.findMany).mockResolvedValue(mockBookings as Booking[]);

            const result = await getAgencyMarketplaceConversions(agencyId, 24);

            expect(result.summary.totalClicks).toBe(1);
            expect(result.summary.conversions).toBe(1);
            expect(result.summary.conversionRate).toBe("100.00%");
            expect(result.details[0].converted).toBe(true);
        });

        it("should not link clicks outside conversion window", async () => {
            const agencyId = "agency_123";
            const treklerId = "trekker_456";
            const clickTime = new Date("2025-01-10T14:00:00Z");
            const bookingTime = new Date("2025-01-11T18:00:00Z"); // 28 hours later, outside 24h window

            const mockClicks = [
                {
                    id: "click_1",
                    agencyId,
                    treklerId,
                    destination: "agency-profile",
                    searchQuery: "everest",
                    timestamp: clickTime,
                    createdAt: new Date(),
                },
            ];

            const mockBookings = [
                {
                    id: "booking_1",
                    agencyId,
                    trekkerId: treklerId,
                    status: "PENDING",
                    trekkerEmail: "trekker@example.com",
                    createdAt: bookingTime,
                },
            ];

            vi.mocked(prisma.marketplaceClick.findMany).mockResolvedValue(mockClicks as MarketplaceClick[]);
            vi.mocked(prisma.booking.findMany).mockResolvedValue(mockBookings as Booking[]);

            const result = await getAgencyMarketplaceConversions(agencyId, 24);

            expect(result.summary.conversions).toBe(0);
            expect(result.summary.conversionRate).toBe("0.00%");
        });

        it("should handle anonymous clicks (no trekker ID)", async () => {
            const agencyId = "agency_123";

            const mockClicks = [
                {
                    id: "click_1",
                    agencyId,
                    treklerId: null, // Anonymous
                    destination: "agency-profile",
                    searchQuery: "annapurna",
                    timestamp: new Date(),
                    createdAt: new Date(),
                },
            ];

            vi.mocked(prisma.marketplaceClick.findMany).mockResolvedValue(mockClicks as MarketplaceClick[]);
            vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

            const result = await getAgencyMarketplaceConversions(agencyId);

            expect(result.summary.totalClicks).toBe(1);
            expect(result.summary.conversions).toBe(0);
        });
    });

    // ──── getTopAgenciesByImpressions ────

    describe("getTopAgenciesByImpressions", () => {
        it("should return top agencies ranked by impressions", async () => {
            const mockResults = [
                {
                    agencyId: "agency_1",
                    _sum: {
                        impressionCount: 500,
                        clickCount: 50,
                        conversionCount: 5,
                    },
                },
                {
                    agencyId: "agency_2",
                    _sum: {
                        impressionCount: 300,
                        clickCount: 30,
                        conversionCount: 3,
                    },
                },
            ];

            const mockAgencies = [
                {
                    id: "agency_1",
                    name: "Summit Trek",
                    slug: "summit-trek",
                    tier: { name: "LARGE" },
                },
                {
                    id: "agency_2",
                    name: "Himalayan Guides",
                    slug: "himalayan-guides",
                    tier: { name: "MEDIUM" },
                },
            ];

            vi.mocked(prisma.marketplaceImpression.groupBy).mockResolvedValue(
                mockResults as Awaited<
                    ReturnType<typeof prisma.marketplaceImpression.groupBy>
                >
            );

            vi.mocked(prisma.agency.findUnique)
                .mockResolvedValueOnce(
                    mockAgencies[0] as Awaited<ReturnType<typeof prisma.agency.findUnique>>
                )
                .mockResolvedValueOnce(
                    mockAgencies[1] as Awaited<ReturnType<typeof prisma.agency.findUnique>>
                );

            const result = await getTopAgenciesByImpressions("last_7_days", 10);

            expect(result.period).toBe("last_7_days");
            expect(result.limit).toBe(10);
            expect(result.data).toHaveLength(2);
            expect(result.data[0].impressions).toBe(500);
            // FIX #4: Changed from "10.00%" to "10.00" - service returns without %
            expect(result.data[0].ctr).toBe("10.00");
        });

        it("should handle agencies with no clicks", async () => {
            const mockResults = [
                {
                    agencyId: "agency_1",
                    _sum: {
                        impressionCount: 100,
                        clickCount: 0,
                        conversionCount: 0,
                    },
                },
            ];

            const mockAgency = {
                id: "agency_1",
                name: "No Clicks Agency",
                slug: "no-clicks",
                tier: { name: "SMALL" },
            };

            vi.mocked(prisma.marketplaceImpression.groupBy).mockResolvedValue(
                mockResults as Awaited<
                    ReturnType<typeof prisma.marketplaceImpression.groupBy>
                >
            );
            vi.mocked(prisma.agency.findUnique).mockResolvedValue(
                mockAgency as Awaited<ReturnType<typeof prisma.agency.findUnique>>
            );
            const result = await getTopAgenciesByImpressions("last_30_days", 5);

            // FIX #5: Changed from "0.00%" to "0.00" - service returns without %
            expect(result.data[0].ctr).toBe("0.00");
        });
    });
});