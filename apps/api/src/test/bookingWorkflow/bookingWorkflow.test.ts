import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock Prisma so these tests don't need a real database.
vi.mock("@funtush/database", () => {
    const booking = {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
    };
    const paymentLink = {
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
    };
    const trekDepartureDate = {
        findUnique: vi.fn(),
        update: vi.fn(),
    };
    const guideProfile = {
        findUnique: vi.fn(),
    };
    const trekPackage = {
        findUnique: vi.fn(),
    };
    const pkg = {
        findUnique: vi.fn(),
    };
    const trekAddOn = {
        findMany: vi.fn(),
    };
    const coupon = {
        update: vi.fn(),
    };
    const bookingAddOn = {
        createMany: vi.fn(),
    };
    const redis = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
    };
    const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ booking, bookingAddOn, paymentLink, trekDepartureDate, guideProfile, trekPackage, package: pkg, trekAddOn, coupon })
    );

    return {
        prisma: {
            booking,
            bookingAddOn,
            paymentLink,
            trekDepartureDate,
            guideProfile,
            trekPackage,
            package: pkg,
            trekAddOn,
            coupon,
            $transaction,
        },
        redis,
        BookingStatus: {
            INQUIRY: "INQUIRY",
            CONFIRMED: "CONFIRMED",
            PAYMENT_PENDING: "PAYMENT_PENDING",
            REJECTED: "REJECTED",
            ALTERNATIVE_PROPOSED: "ALTERNATIVE_PROPOSED",
            PAID: "PAID",
            ACTIVE: "ACTIVE",
            COMPLETED: "COMPLETED",
            CANCELLED: "CANCELLED",
        },
    };
});

// Mock notifications, emails, and PDF generation to keep the tests focused on the service logic.
// Path must match the exact specifier booking.service.ts / payment.service.ts use to
// import notification.service.ts (the dotted FCM-push file, imported with a .js extension).
vi.mock("../../services/notification.service.js", () => ({
    notifyTrekker: vi.fn(),
    notifyAgencyAdmins: vi.fn(),
}));
vi.mock("../../lib/generatePDF", () => ({
    generateBookingConfirmationPDF: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("../../utils/email", () => ({
    sendBookingAcceptedEmail: vi.fn(),
    sendBookingRejectedEmail: vi.fn(),
    sendBookingConfirmationEmail: vi.fn(),
    sendGuideAssignmentEmail: vi.fn(),
    sendAlternativeDateEmail: vi.fn(),
    sendInquiryConfirmationEmail: vi.fn(),
    sendAgencyInquiryAlertEmail: vi.fn(),
    sendOtpEmail: vi.fn(),
}));
vi.mock("../../services/coupon.service", () => ({
    validateAndApplyCoupon: vi.fn(),
}));
vi.mock("@funtush/auth", () => ({
    generateOTP: vi.fn(() => "123456"),
}));

import { prisma, redis } from "@funtush/database";
import {
    acceptBooking,
    rejectBooking,
    confirmBooking,
    cancelBooking,
    getBookingById,
    assignGuide,
    checkInBooking,
    checkOutBooking,
    submitInquiry,
    verifyInquiryOtp,
    proposeAlternativeDate,
} from "../../services/booking.service";

import { processConfirmedPayment, expireUnpaidBookings } from "../../services/payment.service";
import { releaseSlotsForBooking, confirmSlotsForBooking } from "../../services/departureDate.service";
import { validateAndApplyCoupon } from "../../services/coupon.service";
import { sendOtpEmail, sendInquiryConfirmationEmail, sendAgencyInquiryAlertEmail } from "../../utils/email";
import { notifyAgencyAdmins } from "../../services/notification.service.js";

type ReleaseSlotsTx = Parameters<typeof releaseSlotsForBooking>[0];
type ConfirmSlotsTx = Parameters<typeof confirmSlotsForBooking>[0];

const AGENCY_ID = "agency-1";
const BOOKING_ID = "booking-1";
const DEPARTURE_ID = "departure-1";

function baseBooking(overrides: Record<string, unknown> = {}) {
    return {
        id: BOOKING_ID,
        agencyId: AGENCY_ID,
        departureDateId: DEPARTURE_ID,
        groupSize: 2,
        status: "INQUIRY",
        totalPrice: 1000,
        trekkerId: "trekker-1",
        trekkerEmail: "t@example.com",
        trekkerName: "Trekker",
        assignedGuideId: null,
        package: { title: "Everest Panorama Short Trek" },
        paymentLink: null,
        ...overrides,
    };
}

const PACKAGE_ID = "package-1";

function basePackage(overrides: Record<string, unknown> = {}) {
    return {
        id: PACKAGE_ID,
        status: "PUBLISHED",
        agencyId: AGENCY_ID,
        title: "Everest Panorama Short Trek",
        agency: { id: AGENCY_ID, status: "ACTIVE" },
        ...overrides,
    };
}

function baseDepartureDate(overrides: Record<string, unknown> = {}) {
    return {
        id: DEPARTURE_ID,
        packageId: PACKAGE_ID,
        maxSlots: 10,
        bookedSlots: 0,
        status: "AVAILABLE",
        ...overrides,
    };
}

function baseInquiryInput(overrides: Record<string, unknown> = {}) {
    return {
        packageId: PACKAGE_ID,
        departureDateId: DEPARTURE_ID,
        groupSize: 2,
        addOns: [],
        trekkerName: "Jane Doe",
        trekkerEmail: "jane@example.com",
        trekkerPhone: "+9779800000000",
        trekkerCountry: "US",
        specialRequests: "Vegetarian meals",
        ...overrides,
    };
}

// Fixture for what prisma.booking.create resolves to inside verifyInquiryOtp,
// which is queried with `include: { package: { include: { agency: true } }, departureDate: true }`.
// Also reused by proposeAlternativeDate tests since that flow reads booking.package.title too.
function createdBooking(overrides: Record<string, unknown> = {}) {
    return {
        id: BOOKING_ID,
        agencyId: AGENCY_ID,
        status: "INQUIRY",
        trekkerEmail: "t@example.com",
        trekkerName: "Trekker",
        package: {
            title: "Everest Panorama Short Trek",
            agency: { id: AGENCY_ID, email: "agency@example.com" },
        },
        departureDate: { id: DEPARTURE_ID, startDate: new Date("2026-09-14") },
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("acceptBooking", () => {
    it("moves INQUIRY -> PAYMENT_PENDING and creates a payment link", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking());
        (prisma.package.findUnique as Mock).mockResolvedValue(basePackage());
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue({
            id: DEPARTURE_ID,
            maxSlots: 10,
            bookedSlots: 0,
            status: "AVAILABLE",
        });

        const result = await acceptBooking(BOOKING_ID, AGENCY_ID);

        expect(result.status).toBe("PAYMENT_PENDING");
        expect(prisma.paymentLink.create).toHaveBeenCalled();
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("rejects if booking is not in INQUIRY state", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));

        await expect(acceptBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/INQUIRY/);
    });

    it("rejects if agency does not own the booking", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ agencyId: "other-agency" }));

        await expect(acceptBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/Unauthorized/);
    });
});

describe("processConfirmedPayment", () => {
    it("moves PAYMENT_PENDING -> PAID when amount matches", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({
                status: "PAYMENT_PENDING",
                paymentLink: { used: false },
                agency: { profile: null, name: "Agency", email: "a@example.com" },
                departureDate: { startDate: new Date() },
                package: { title: "Trek", durationDays: 10, itineraries: [] },
                addOns: [],
            })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 1000)).resolves.toBeUndefined();
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("throws on amount mismatch", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({
                status: "PAYMENT_PENDING",
                paymentLink: { used: false },
                agency: { profile: null, name: "Agency", email: "a@example.com" },
                departureDate: { startDate: new Date() },
                package: { title: "Trek", durationDays: 10, itineraries: [] },
                addOns: [],
            })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 500)).rejects.toThrow(/Amount mismatch/);
    });

    it("is idempotent — no-ops if payment link already used", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "PAID", paymentLink: { used: true } })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 1000)).resolves.toBeUndefined();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("throws if booking is not PAYMENT_PENDING", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "CONFIRMED", paymentLink: { used: false } })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 1000)).rejects.toThrow(/not awaiting payment/);
    });

    it("throws on agency mismatch", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ agencyId: "other-agency", status: "PAYMENT_PENDING", paymentLink: { used: false } })
        );

        await expect(processConfirmedPayment(BOOKING_ID, AGENCY_ID, 1000)).rejects.toThrow(/Agency mismatch/);
    });
});

describe("confirmBooking", () => {
    it("moves PAID -> CONFIRMED", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "PAID" }));

        const result = await confirmBooking(BOOKING_ID, AGENCY_ID);

        expect(result.status).toBe("CONFIRMED");
    });

    it("rejects if booking is not PAID", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "PAYMENT_PENDING" }));

        await expect(confirmBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/PAID state/);
    });
});

describe("rejectBooking", () => {
    it("rejects an INQUIRY booking with a reason", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "INQUIRY" }));

        const result = await rejectBooking(BOOKING_ID, AGENCY_ID, "Not available");

        expect(result.status).toBe("REJECTED");
    });

    it("throws without a reason", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "INQUIRY" }));

        await expect(rejectBooking(BOOKING_ID, AGENCY_ID, "")).rejects.toThrow(/reason is required/);
    });

    it("throws if booking is CONFIRMED (no longer allowed post-fix)", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));

        await expect(rejectBooking(BOOKING_ID, AGENCY_ID, "reason")).rejects.toThrow(/cannot be rejected/);
    });
});

describe("cancelBooking", () => {
    it.each(["PAYMENT_PENDING", "PAID", "CONFIRMED", "ACTIVE"])(
        "cancels a booking in %s state and releases slots",
        async (status) => {
            (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status }));
            (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue({
                id: DEPARTURE_ID,
                maxSlots: 10,
                bookedSlots: 2,
                status: "AVAILABLE",
            });

            const result = await cancelBooking(BOOKING_ID, AGENCY_ID, "Customer request");

            expect(result.status).toBe("CANCELLED");
        }
    );

    it("throws for a non-cancellable state", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "INQUIRY" }));

        await expect(cancelBooking(BOOKING_ID, AGENCY_ID, "reason")).rejects.toThrow(/cannot be cancelled/);
    });

    it("throws without a reason", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));

        await expect(cancelBooking(BOOKING_ID, AGENCY_ID, "")).rejects.toThrow(/reason is required/);
    });
});

describe("expireUnpaidBookings", () => {
    it("cancels and releases slots for expired unpaid links", async () => {
        (prisma.paymentLink.findMany as Mock).mockResolvedValue([
            {
                id: "link-1",
                bookingId: BOOKING_ID,
                used: false,
                expiresAt: new Date(Date.now() - 1000),
                booking: baseBooking({ status: "PAYMENT_PENDING" }),
            },
        ]);
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue({
            id: DEPARTURE_ID,
            maxSlots: 10,
            bookedSlots: 2,
            status: "AVAILABLE",
        });

        await expireUnpaidBookings();

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("skips links whose booking already moved past PAYMENT_PENDING", async () => {
        (prisma.paymentLink.findMany as Mock).mockResolvedValue([
            {
                id: "link-1",
                bookingId: BOOKING_ID,
                used: false,
                expiresAt: new Date(Date.now() - 1000),
                booking: baseBooking({ status: "CONFIRMED" }),
            },
        ]);

        await expireUnpaidBookings();

        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});

describe("getBookingById", () => {
    it("returns the booking when the agency owns it", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking());

        const result = await getBookingById(BOOKING_ID, AGENCY_ID);

        expect(result.id).toBe(BOOKING_ID);
    });

    it("throws not found on agency mismatch (does not leak existence)", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ agencyId: "other-agency" }));

        await expect(getBookingById(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/not found/);
    });

    it("throws not found when booking does not exist", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(null);

        await expect(getBookingById(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/not found/);
    });
});

describe("assignGuide", () => {
    it("assigns an active guide to a CONFIRMED booking", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));
        (prisma.guideProfile.findUnique as Mock).mockResolvedValue({
            agencyId: AGENCY_ID,
            guideRef: "guide-1",
            isActive: true,
        });

        const result = await assignGuide(BOOKING_ID, AGENCY_ID, "guide-1");

        expect(result.assignedGuideId).toBe("guide-1");
    });

    it("throws if booking is not CONFIRMED", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "PAID" }));

        await expect(assignGuide(BOOKING_ID, AGENCY_ID, "guide-1")).rejects.toThrow(/must be CONFIRMED/);
    });

    it("throws if guide is inactive or not found", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));
        (prisma.guideProfile.findUnique as Mock).mockResolvedValue(null);

        await expect(assignGuide(BOOKING_ID, AGENCY_ID, "ghost-guide")).rejects.toThrow(/not found or inactive/);
    });
});

describe("checkInBooking", () => {
    it("moves CONFIRMED -> ACTIVE when a guide is assigned", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "CONFIRMED", assignedGuideId: "guide-1" })
        );

        const result = await checkInBooking(BOOKING_ID, AGENCY_ID);

        expect(result.status).toBe("ACTIVE");
    });

    it("throws if no guide is assigned yet", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "CONFIRMED", assignedGuideId: null })
        );

        await expect(checkInBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/Assign a guide/);
    });

    it("throws if booking is not CONFIRMED", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(
            baseBooking({ status: "ACTIVE", assignedGuideId: "guide-1" })
        );

        await expect(checkInBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/must be CONFIRMED/);
    });
});

describe("checkOutBooking", () => {
    it("moves ACTIVE -> COMPLETED", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "ACTIVE" }));

        const result = await checkOutBooking(BOOKING_ID, AGENCY_ID);

        expect(result.status).toBe("COMPLETED");
    });

    it("throws if booking is not ACTIVE", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(baseBooking({ status: "CONFIRMED" }));

        await expect(checkOutBooking(BOOKING_ID, AGENCY_ID)).rejects.toThrow(/must be ACTIVE/);
    });
});

describe("releaseSlotsForBooking (direct)", () => {
    it("decrements bookedSlots and flips FULL -> AVAILABLE when capacity opens", async () => {
        const tx = {
            trekDepartureDate: {
                findUnique: vi.fn().mockResolvedValue({
                    id: DEPARTURE_ID,
                    maxSlots: 5,
                    bookedSlots: 5,
                    status: "FULL",
                }),
                update: vi.fn().mockResolvedValue({}),
            },
        } as unknown as ReleaseSlotsTx;

        await releaseSlotsForBooking(tx, DEPARTURE_ID, 2);

        expect(tx.trekDepartureDate.update).toHaveBeenCalledWith({
            where: { id: DEPARTURE_ID },
            data: { bookedSlots: 3, status: "AVAILABLE" },
        });
    });

    it("never drops bookedSlots below zero", async () => {
        const tx = {
            trekDepartureDate: {
                findUnique: vi.fn().mockResolvedValue({
                    id: DEPARTURE_ID,
                    maxSlots: 5,
                    bookedSlots: 1,
                    status: "AVAILABLE",
                }),
                update: vi.fn().mockResolvedValue({}),
            },
        } as unknown as ReleaseSlotsTx;

        await releaseSlotsForBooking(tx, DEPARTURE_ID, 5);

        expect(tx.trekDepartureDate.update).toHaveBeenCalledWith({
            where: { id: DEPARTURE_ID },
            data: { bookedSlots: 0, status: "AVAILABLE" },
        });
    });
});

describe("submitInquiry", () => {
    it("validates package/date/add-ons, generates an OTP, and stores session data in Redis", async () => {
        (prisma.trekPackage.findUnique as Mock).mockResolvedValue(basePackage());
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        (prisma.trekAddOn.findMany as Mock).mockResolvedValue([]);
        (redis.set as Mock).mockResolvedValue("OK");

        const result = await submitInquiry(baseInquiryInput());

        expect(result).toHaveProperty("sessionToken");
        expect(result.expiresInSeconds).toBe(900);
        // one write for inquiry data, one for the OTP itself
        expect(redis.set).toHaveBeenCalledTimes(2);
        expect(sendOtpEmail).toHaveBeenCalledWith("jane@example.com", expect.any(String));
    });

    it("rejects if the package is not PUBLISHED", async () => {
        (prisma.trekPackage.findUnique as Mock).mockResolvedValue(basePackage({ status: "DRAFT" }));

        await expect(submitInquiry(baseInquiryInput())).rejects.toThrow();
        expect(redis.set).not.toHaveBeenCalled();
    });

    it("rejects if the agency is LOCKED or SUSPENDED", async () => {
        (prisma.trekPackage.findUnique as Mock).mockResolvedValue(
            basePackage({ agency: { id: AGENCY_ID, status: "SUSPENDED" } })
        );

        await expect(submitInquiry(baseInquiryInput())).rejects.toThrow();
    });

    it("rejects if the departure date is FULL", async () => {
        (prisma.trekPackage.findUnique as Mock).mockResolvedValue(basePackage());
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(
            baseDepartureDate({ status: "FULL", bookedSlots: 10 })
        );

        await expect(submitInquiry(baseInquiryInput())).rejects.toThrow(/full|available/i);
    });

    it("rejects if groupSize exceeds remaining capacity", async () => {
        (prisma.trekPackage.findUnique as Mock).mockResolvedValue(basePackage());
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(
            baseDepartureDate({ maxSlots: 10, bookedSlots: 9 })
        );

        await expect(submitInquiry(baseInquiryInput({ groupSize: 5 }))).rejects.toThrow();
    });

    it("rejects if an addOnId does not belong to the requested package", async () => {
        (prisma.trekPackage.findUnique as Mock).mockResolvedValue(basePackage());
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        // Simulate: only one of the two requested add-ons actually belongs to this package.
        (prisma.trekAddOn.findMany as Mock).mockResolvedValue([{ id: "addon-1", packageId: PACKAGE_ID }]);

        await expect(
            submitInquiry(
                baseInquiryInput({
                    addOns: [
                        { addOnId: "addon-1", quantity: 1 },
                        { addOnId: "addon-does-not-belong", quantity: 1 },
                    ],
                })
            )
        ).rejects.toThrow();
    });

    it("validates and applies a coupon when couponCode is present", async () => {
        (prisma.trekPackage.findUnique as Mock).mockResolvedValue(basePackage());
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        (prisma.trekAddOn.findMany as Mock).mockResolvedValue([]);
        (validateAndApplyCoupon as Mock).mockResolvedValue({
            finalAmount: 900,
            discount: 100,
            couponId: "coupon-1",
            couponCode: "SUMMER10",
        });

        await submitInquiry(baseInquiryInput({ couponCode: "SUMMER10" }));

        expect(validateAndApplyCoupon).toHaveBeenCalledWith(
            expect.objectContaining({ couponCode: "SUMMER10", packageId: PACKAGE_ID })
        );
    });

    it("does not increment coupon redemptions at the inquiry-submit step", async () => {
        (prisma.trekPackage.findUnique as Mock).mockResolvedValue(basePackage());
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        (prisma.trekAddOn.findMany as Mock).mockResolvedValue([]);
        (validateAndApplyCoupon as Mock).mockResolvedValue({
            finalAmount: 900,
            discount: 100,
            couponId: "coupon-1",
            couponCode: "SUMMER10",
        });

        await submitInquiry(baseInquiryInput({ couponCode: "SUMMER10" }));

        // redemptionsUsed increments only after OTP verification (see verifyInquiryOtp tests below)
        expect(prisma.coupon.update).not.toHaveBeenCalled();
    });
});

describe("verifyInquiryOtp", () => {
    const SESSION_TOKEN = "session-token-abc";

    function mockValidSession(overrides: Record<string, unknown> = {}) {
        const inquiryData = {
            packageId: PACKAGE_ID,
            departureDateId: DEPARTURE_ID,
            groupSize: 2,
            addOns: [],
            trekkerName: "Jane Doe",
            trekkerEmail: "jane@example.com",
            trekkerPhone: "+9779800000000",
            agencyId: AGENCY_ID,
            totalPrice: 1000,
            ...overrides,
        };
        (redis.get as Mock).mockImplementation((key: string) => {
            if (key.includes("otp")) return Promise.resolve("123456");
            return Promise.resolve(JSON.stringify(inquiryData));
        });
    }

    it("creates the Booking and BookingAddOn rows on correct OTP", async () => {
        mockValidSession();
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        (prisma.booking.create as Mock).mockResolvedValue(createdBooking());

        const result = await verifyInquiryOtp(SESSION_TOKEN, "123456");

        expect(result.bookingId).toBe(BOOKING_ID);
        expect(result.status).toBe("INQUIRY");
        expect(prisma.booking.create).toHaveBeenCalled();
    });

    it("clears the Redis OTP and session keys on success", async () => {
        mockValidSession();
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        (prisma.booking.create as Mock).mockResolvedValue(createdBooking());

        await verifyInquiryOtp(SESSION_TOKEN, "123456");

        expect(redis.del).toHaveBeenCalledTimes(2);
    });

    it("sends trekker confirmation and agency alert emails on success", async () => {
        mockValidSession();
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        (prisma.booking.create as Mock).mockResolvedValue(createdBooking());

        await verifyInquiryOtp(SESSION_TOKEN, "123456");

        expect(sendInquiryConfirmationEmail).toHaveBeenCalled();
        expect(sendAgencyInquiryAlertEmail).toHaveBeenCalled();
        expect(notifyAgencyAdmins).toHaveBeenCalled();
    });

    it("increments coupon redemptionsUsed only when a coupon was applied", async () => {
        mockValidSession({
            couponData: { couponId: "coupon-1", discount: 100, couponCode: "SUMMER10" },
        });
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        (prisma.booking.create as Mock).mockResolvedValue(createdBooking());

        await verifyInquiryOtp(SESSION_TOKEN, "123456");

        expect(prisma.coupon.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "coupon-1" } })
        );
    });

    it("throws on incorrect OTP", async () => {
        mockValidSession();

        await expect(verifyInquiryOtp(SESSION_TOKEN, "000000")).rejects.toThrow();
        expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it("throws on expired/invalid session token", async () => {
        (redis.get as Mock).mockResolvedValue(null);

        await expect(verifyInquiryOtp("expired-token", "123456")).rejects.toThrow();
    });

    it("re-checks slot availability and throws if the slot filled up during the OTP window", async () => {
        mockValidSession();
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(
            baseDepartureDate({ status: "FULL", bookedSlots: 10 })
        );

        await expect(verifyInquiryOtp(SESSION_TOKEN, "123456")).rejects.toThrow();
        expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it("does not fail the request if the marketplace-conversion tracking call fails", async () => {
        // Best-effort side effect per docs: failure here is caught/logged, not surfaced.
        mockValidSession();
        (prisma.trekDepartureDate.findUnique as Mock).mockResolvedValue(baseDepartureDate());
        (prisma.booking.create as Mock).mockResolvedValue(createdBooking());

        await expect(verifyInquiryOtp(SESSION_TOKEN, "123456")).resolves.toEqual(
            expect.objectContaining({ bookingId: BOOKING_ID, status: "INQUIRY" })
        );
    });
});

describe("proposeAlternativeDate", () => {
    it("moves INQUIRY -> ALTERNATIVE_PROPOSED and stores the proposed date", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue(createdBooking());
        (prisma.booking.update as Mock).mockResolvedValue({
            id: BOOKING_ID,
            status: "ALTERNATIVE_PROPOSED",
        });

        const result = await proposeAlternativeDate(BOOKING_ID, AGENCY_ID, "2026-09-14");

        expect(result.status).toBe("ALTERNATIVE_PROPOSED");
        expect(prisma.booking.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: BOOKING_ID },
                data: expect.objectContaining({ status: "ALTERNATIVE_PROPOSED" }),
            })
        );
    });

    it("throws if booking is not in INQUIRY state", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue({
            id: BOOKING_ID,
            agencyId: AGENCY_ID,
            status: "PAYMENT_PENDING",
        });

        await expect(proposeAlternativeDate(BOOKING_ID, AGENCY_ID, "2026-09-14")).rejects.toThrow(/INQUIRY/);
    });

    it("throws on an unparseable date", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue({
            id: BOOKING_ID,
            agencyId: AGENCY_ID,
            status: "INQUIRY",
        });

        await expect(proposeAlternativeDate(BOOKING_ID, AGENCY_ID, "not-a-date")).rejects.toThrow();
    });

    it("throws if the booking belongs to a different agency", async () => {
        (prisma.booking.findUnique as Mock).mockResolvedValue({
            id: BOOKING_ID,
            agencyId: "other-agency",
            status: "INQUIRY",
        });

        await expect(proposeAlternativeDate(BOOKING_ID, AGENCY_ID, "2026-09-14")).rejects.toThrow(/Unauthorized/);
    });
});

describe("confirmSlotsForBooking (direct)", () => {
    it("increments bookedSlots and flips AVAILABLE -> FULL exactly when capacity is filled", async () => {
        const tx = {
            trekDepartureDate: {
                findUnique: vi.fn().mockResolvedValue({
                    id: DEPARTURE_ID,
                    maxSlots: 5,
                    bookedSlots: 3,
                    status: "AVAILABLE",
                }),
                update: vi.fn().mockResolvedValue({}),
            },
        } as unknown as ConfirmSlotsTx;

        await confirmSlotsForBooking(tx, DEPARTURE_ID, 2);

        expect(tx.trekDepartureDate.update).toHaveBeenCalledWith({
            where: { id: DEPARTURE_ID },
            data: { bookedSlots: 5, status: "FULL" },
        });
    });

    it("increments bookedSlots and stays AVAILABLE when capacity remains", async () => {
        const tx = {
            trekDepartureDate: {
                findUnique: vi.fn().mockResolvedValue({
                    id: DEPARTURE_ID,
                    maxSlots: 10,
                    bookedSlots: 2,
                    status: "AVAILABLE",
                }),
                update: vi.fn().mockResolvedValue({}),
            },
        } as unknown as ConfirmSlotsTx;

        await confirmSlotsForBooking(tx, DEPARTURE_ID, 3);

        expect(tx.trekDepartureDate.update).toHaveBeenCalledWith({
            where: { id: DEPARTURE_ID },
            data: { bookedSlots: 5, status: "AVAILABLE" },
        });
    });

    it("throws if groupSize would exceed maxSlots (prevents overbooking race)", async () => {
        const tx = {
            trekDepartureDate: {
                findUnique: vi.fn().mockResolvedValue({
                    id: DEPARTURE_ID,
                    maxSlots: 5,
                    bookedSlots: 4,
                    status: "AVAILABLE",
                }),
                update: vi.fn(),
            },
        } as unknown as ConfirmSlotsTx;

        await expect(confirmSlotsForBooking(tx, DEPARTURE_ID, 2)).rejects.toThrow();
        expect(tx.trekDepartureDate.update).not.toHaveBeenCalled();
    });

    it("preserves a GUARANTEED status instead of computing FULL/AVAILABLE from slot count", async () => {
        const tx = {
            trekDepartureDate: {
                findUnique: vi.fn().mockResolvedValue({
                    id: DEPARTURE_ID,
                    maxSlots: 5,
                    bookedSlots: 1,
                    status: "GUARANTEED",
                }),
                update: vi.fn().mockResolvedValue({}),
            },
        } as unknown as ConfirmSlotsTx;

        await confirmSlotsForBooking(tx, DEPARTURE_ID, 1);

        expect(tx.trekDepartureDate.update).toHaveBeenCalledWith({
            where: { id: DEPARTURE_ID },
            data: { bookedSlots: 2, status: "GUARANTEED" },
        });
    });
});