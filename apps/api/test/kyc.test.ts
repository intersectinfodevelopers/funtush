import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockPrisma = {
  kYCSubmission: {
    findMany:  vi.fn(),
    findUnique: vi.fn(),
    update:    vi.fn(),
  },
  agency: { update: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock("../src/packages/database/prisma", () => ({ prisma: mockPrisma }));

// ── Mock emailQueue ───────────────────────────────────────────────────────────
const queueEmailMock = vi.fn().mockResolvedValue("email_id_123");
const getEmailQueueMock = vi.fn().mockResolvedValue([]);

vi.mock("../src/lib/emailQueue", () => ({
  queueEmail:    (...args: any[]) => queueEmailMock(...args),
  getEmailQueue: (...args: any[]) => getEmailQueueMock(...args),
}));

import {
  getKycQueue,
  getKycSubmission,
  approveKycSubmission,
  rejectKycSubmission,
  listEmailQueue,
} from "../src/services/kyc.service";

const PENDING_SUBMISSION = {
  id:        "kyc_001",
  agencyId:  "agency_xyz",
  status:    "PENDING",
  submittedAt: new Date("2024-01-15"),
  agency:    { id: "agency_xyz", name: "XYZ Adventures", email: "admin@xyz.com" },
};

describe("KYC service", () => {

  beforeEach(() => vi.clearAllMocks());

  // ── DAY 4: KYC Queue ──────────────────────────────────────────────────────

  it("getKycQueue returns PENDING submissions sorted by submittedAt asc", async () => {
    mockPrisma.kYCSubmission.findMany.mockResolvedValue([PENDING_SUBMISSION]);
    const result = await getKycQueue();
    const call = mockPrisma.kYCSubmission.findMany.mock.calls[0][0];
    expect(call.where.status).toBe("PENDING");
    expect(call.orderBy.submittedAt).toBe("asc");
    expect(result).toHaveLength(1);
  });

  it("getKycSubmission includes agency and documents", async () => {
    const full = { ...PENDING_SUBMISSION, documents: [{ url: "https://docs.example.com/kyc.pdf" }] };
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue(full);
    const result = await getKycSubmission("kyc_001");
    expect(mockPrisma.kYCSubmission.findUnique.mock.calls[0][0].include.documents).toBe(true);
    expect(result?.documents).toHaveLength(1);
  });

  it("getKycSubmission returns null for unknown id", async () => {
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue(null);
    const result = await getKycSubmission("kyc_unknown");
    expect(result).toBeNull();
  });

  it("approveKycSubmission sets status APPROVED and awards badge", async () => {
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue(PENDING_SUBMISSION);
    const updated = { id: "kyc_001", status: "APPROVED", reviewedAt: new Date(), agencyId: "agency_xyz" };
    mockPrisma.$transaction.mockResolvedValue([updated, {}]);

    const result = await approveKycSubmission("kyc_001");

    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    const [kycUpdate, agencyUpdate] = mockPrisma.$transaction.mock.calls[0][0];
    // Verify status set to APPROVED
    expect(result.status).toBe("APPROVED");
  });

  it("approveKycSubmission queues approval email", async () => {
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue(PENDING_SUBMISSION);
    mockPrisma.$transaction.mockResolvedValue([
      { id: "kyc_001", status: "APPROVED", reviewedAt: new Date(), agencyId: "agency_xyz" },
      {},
    ]);
    await approveKycSubmission("kyc_001");
    // Allow fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(queueEmailMock).toHaveBeenCalledWith(
      "admin@xyz.com",
      expect.stringContaining("approved"),
      expect.stringContaining("XYZ Adventures")
    );
  });

  it("approveKycSubmission throws if submission not found", async () => {
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue(null);
    await expect(approveKycSubmission("kyc_missing")).rejects.toThrow("not found");
  });

  it("approveKycSubmission throws if already reviewed", async () => {
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue({ ...PENDING_SUBMISSION, status: "APPROVED" });
    await expect(approveKycSubmission("kyc_001")).rejects.toThrow("already");
  });

  it("rejectKycSubmission sets status REJECTED with reason", async () => {
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue(PENDING_SUBMISSION);
    mockPrisma.kYCSubmission.update.mockResolvedValue({
      id: "kyc_001", status: "REJECTED", rejectionReason: "Documents blurry", reviewedAt: new Date(), agencyId: "agency_xyz",
    });
    const result = await rejectKycSubmission("kyc_001", "Documents blurry");
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe("Documents blurry");
  });

  it("rejectKycSubmission queues rejection email with reason", async () => {
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue(PENDING_SUBMISSION);
    mockPrisma.kYCSubmission.update.mockResolvedValue({
      id: "kyc_001", status: "REJECTED", rejectionReason: "Expired ID", reviewedAt: new Date(), agencyId: "agency_xyz",
    });
    await rejectKycSubmission("kyc_001", "Expired ID");
    await new Promise((r) => setTimeout(r, 10));
    expect(queueEmailMock).toHaveBeenCalledWith(
      "admin@xyz.com",
      expect.stringContaining("rejected"),
      expect.stringContaining("Expired ID")
    );
  });

  it("rejectKycSubmission throws if submission not found", async () => {
    mockPrisma.kYCSubmission.findUnique.mockResolvedValue(null);
    await expect(rejectKycSubmission("kyc_missing", "reason")).rejects.toThrow("not found");
  });

  // ── Email Queue ────────────────────────────────────────────────────────────

  it("listEmailQueue queries all statuses by default", async () => {
    await listEmailQueue();
    expect(getEmailQueueMock).toHaveBeenCalledWith({ status: ["pending", "sent", "failed"] });
  });

  it("listEmailQueue accepts custom status filter", async () => {
    await listEmailQueue(["pending"]);
    expect(getEmailQueueMock).toHaveBeenCalledWith({ status: ["pending"] });
  });
});
