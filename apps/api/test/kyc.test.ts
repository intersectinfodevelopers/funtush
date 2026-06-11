import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    kycSubmission: {
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    agency:       { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// ── Mock emailQueue ───────────────────────────────────────────────────────────
const queueEmailMock    = vi.fn().mockResolvedValue("email_id_123");
const getEmailQueueMock = vi.fn().mockResolvedValue([]);

vi.mock("../src/lib/emailQueue", () => ({
  queueEmail:    (...args: unknown[]) => queueEmailMock(...args),
  getEmailQueue: (...args: unknown[]) => getEmailQueueMock(...args),
}));

import {
  getKycQueue,
  getKycSubmission,
  approveKycSubmission,
  rejectKycSubmission,
  listEmailQueue,
} from "../src/services/kyc.service";
import { prisma } from "../src/packages/database/prisma";

const PENDING_SUBMISSION = {
  id:          "kyc_001",
  agencyId:    "agency_xyz",
  status:      "SUBMITTED",
  submittedAt: new Date("2024-01-15"),
  agency:      { id: "agency_xyz", name: "XYZ Adventures", email: "admin@xyz.com" },
};

describe("KYC service", () => {

  beforeEach(() => vi.clearAllMocks());

  it("getKycQueue returns PENDING submissions sorted by submittedAt asc", async () => {
    vi.mocked(prisma.kycSubmission.findMany).mockResolvedValue([PENDING_SUBMISSION] as never);
    const result = await getKycQueue();
    const call   = vi.mocked(prisma.kycSubmission.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect((call.where as Record<string, unknown>).status).toBe("SUBMITTED");
    expect((call.orderBy as Record<string, unknown>).submittedAt).toBe("asc");
    expect(result).toHaveLength(1);
  });

  it("getKycSubmission includes agency and documents", async () => {
    const full = { ...PENDING_SUBMISSION, documents: [{ url: "https://docs.example.com/kyc.pdf" }] };
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue(full as never);
    const result = await getKycSubmission("kyc_001") as Record<string, unknown>;
    const call = vi.mocked(prisma.kycSubmission.findUnique).mock.calls[0][0] as Record<string, unknown>;
    expect((call.include as Record<string, unknown>).documents).toBe(true);
    expect((result.documents as unknown[]).length).toBe(1);
  });

  it("getKycSubmission returns null for unknown id", async () => {
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue(null);
    const result = await getKycSubmission("kyc_unknown");
    expect(result).toBeNull();
  });

  it("approveKycSubmission sets status APPROVED", async () => {
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue(PENDING_SUBMISSION as never);
    const updated = { id: "kyc_001", status: "APPROVED", reviewedAt: new Date(), agencyId: "agency_xyz" };
    vi.mocked(prisma.kycSubmission.update).mockResolvedValue(updated as never);
    const result = await approveKycSubmission("kyc_001") as Record<string, unknown>;
    expect(prisma.kycSubmission.update).toHaveBeenCalledOnce();
    expect(result.status).toBe("APPROVED");
  });

  it("approveKycSubmission queues approval email", async () => {
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue(PENDING_SUBMISSION as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([
      { id: "kyc_001", status: "APPROVED", reviewedAt: new Date(), agencyId: "agency_xyz" },
      {},
    ] as never);
    await approveKycSubmission("kyc_001");
    await new Promise((r) => setTimeout(r, 10));
    expect(queueEmailMock).toHaveBeenCalledWith(
      "admin@xyz.com",
      expect.stringContaining("approved"),
      expect.stringContaining("XYZ Adventures")
    );
  });

  it("approveKycSubmission throws if submission not found", async () => {
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue(null);
    await expect(approveKycSubmission("kyc_missing")).rejects.toThrow("not found");
  });

  it("approveKycSubmission throws if already reviewed", async () => {
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue({ ...PENDING_SUBMISSION, status: "APPROVED" } as never);
    await expect(approveKycSubmission("kyc_001")).rejects.toThrow("already");
  });

  it("rejectKycSubmission sets status REJECTED with reason", async () => {
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue(PENDING_SUBMISSION as never);
    vi.mocked(prisma.kycSubmission.update).mockResolvedValue({
      id: "kyc_001", status: "REJECTED", rejectionReason: "Documents blurry", reviewedAt: new Date(), agencyId: "agency_xyz",
    } as never);
    const result = await rejectKycSubmission("kyc_001", "Documents blurry") as Record<string, unknown>;
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe("Documents blurry");
  });

  it("rejectKycSubmission queues rejection email with reason", async () => {
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue(PENDING_SUBMISSION as never);
    vi.mocked(prisma.kycSubmission.update).mockResolvedValue({
      id: "kyc_001", status: "REJECTED", rejectionReason: "Expired ID", reviewedAt: new Date(), agencyId: "agency_xyz",
    } as never);
    await rejectKycSubmission("kyc_001", "Expired ID");
    await new Promise((r) => setTimeout(r, 10));
    expect(queueEmailMock).toHaveBeenCalledWith(
      "admin@xyz.com",
      expect.stringContaining("rejected"),
      expect.stringContaining("Expired ID")
    );
  });

  it("rejectKycSubmission throws if submission not found", async () => {
    vi.mocked(prisma.kycSubmission.findUnique).mockResolvedValue(null);
    await expect(rejectKycSubmission("kyc_missing", "reason")).rejects.toThrow("not found");
  });

  it("listEmailQueue queries all statuses by default", async () => {
    await listEmailQueue();
    expect(getEmailQueueMock).toHaveBeenCalledWith({ status: ["pending", "sent", "failed"] });
  });

  it("listEmailQueue accepts custom status filter", async () => {
    await listEmailQueue(["pending"]);
    expect(getEmailQueueMock).toHaveBeenCalledWith({ status: ["pending"] });
  });
});
