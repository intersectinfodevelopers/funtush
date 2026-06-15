import { describe, it, expect, vi, beforeEach } from "vitest";

// booking.service.ts imports prisma + redis from "@funtush/database",
// generateOTP from "@funtush/auth", plus email + notification helpers. Mock all
// of them so the unit test never touches a DB, Redis, SMTP, or push provider.
vi.mock("@funtush/database", () => {
  const client = {
    trekPackage: { findUnique: vi.fn() },
    trekDepartureDate: { findUnique: vi.fn() },
    trekAddOn: { findMany: vi.fn() },
    booking: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  const redis = { set: vi.fn().mockResolvedValue("OK"), get: vi.fn(), del: vi.fn() };
  return { db: client, prisma: client, redis };
});

const sendOtpEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/utils/email", () => ({
  sendOtpEmail: (...a: unknown[]) => sendOtpEmail(...a),
  sendInquiryConfirmationEmail: vi.fn(),
  sendAgencyInquiryAlertEmail: vi.fn(),
  sendBookingAcceptedEmail: vi.fn(),
  sendBookingRejectedEmail: vi.fn(),
  sendAlternativeDateEmail: vi.fn(),
}));
vi.mock("../src/services/notification.service.js", () => ({
  notifyAgencyAdmins: vi.fn(),
  notifyTrekker: vi.fn(),
}));
vi.mock("@funtush/auth", () => ({ generateOTP: () => "123456" }));

import { submitInquiry } from "../src/services/booking.service";
import { prisma } from "@funtush/database";

const BASE_INPUT = {
  packageId: "pkg_1",
  departureDateId: "dep_1",
  groupSize: 2,
  trekkerName: "Asha",
  trekkerEmail: "asha@example.com",
  trekkerPhone: "9812345678",
};

// Arrange a published package owned by an active agency.
const publishedPackage = () =>
  vi.mocked(prisma.trekPackage.findUnique).mockResolvedValue({
    id: "pkg_1",
    agencyId: "agency_A",
    status: "PUBLISHED",
    pricePerPerson: 1000,
    agency: { status: "ACTIVE" },
  } as never);

const departure = (over = {}) =>
  vi.mocked(prisma.trekDepartureDate.findUnique).mockResolvedValue({
    id: "dep_1",
    packageId: "pkg_1",
    maxSlots: 10,
    bookedSlots: 5,
    status: "AVAILABLE",
    ...over,
  } as never);

beforeEach(() => vi.clearAllMocks());

describe("submitInquiry — full-slots prevention", () => {
  it("rejects when the departure date is FULL, before sending an OTP", async () => {
    publishedPackage();
    departure({ status: "FULL", bookedSlots: 10 });

    await expect(submitInquiry(BASE_INPUT)).rejects.toThrow(/full/i);
    expect(sendOtpEmail).not.toHaveBeenCalled(); // fail fast — no side effects
  });

  it("rejects when the group is larger than the remaining slots", async () => {
    publishedPackage();
    departure({ maxSlots: 10, bookedSlots: 9 }); // 1 left

    await expect(submitInquiry({ ...BASE_INPUT, groupSize: 2 })).rejects.toThrow("Only 1 slot(s) available");
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("allows a group that exactly fills the remaining slots (boundary)", async () => {
    publishedPackage();
    departure({ maxSlots: 10, bookedSlots: 8 }); // 2 left

    const result = await submitInquiry({ ...BASE_INPUT, groupSize: 2 });
    expect(result.sessionToken).toEqual(expect.any(String));
    expect(sendOtpEmail).toHaveBeenCalledWith("asha@example.com", "123456");
  });

  it("rejects an inquiry against an unpublished package", async () => {
    vi.mocked(prisma.trekPackage.findUnique).mockResolvedValue({
      id: "pkg_1",
      status: "DRAFT",
      agency: { status: "ACTIVE" },
    } as never);

    await expect(submitInquiry(BASE_INPUT)).rejects.toThrow("not available");
  });

  it("rejects when the departure belongs to a different package", async () => {
    publishedPackage();
    departure({ packageId: "pkg_OTHER" });

    await expect(submitInquiry(BASE_INPUT)).rejects.toThrow("Invalid departure date");
  });
});
