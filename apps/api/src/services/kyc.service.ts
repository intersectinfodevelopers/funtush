import { prisma } from "../packages/database/prisma";
import { queueEmail, getEmailQueue, EmailStatus } from "../lib/emailQueue";

/**
 * Returns all pending KYC submissions in submission order.
 */
export async function getKycQueue() {
  return prisma.kycSubmission.findMany({
    where: { status: "SUBMITTED" },
    orderBy: { submittedAt: "asc" },
    select: {
      id: true,
      agencyId: true,
      status: true,
      submittedAt: true,
      agency: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

/**
 * Returns a KYC submission with agency and document details.
 */
export async function getKycSubmission(id: string) {
  return prisma.kycSubmission.findUnique({
    where: { id },
    include: {
      agency: {
        select: { id: true, name: true, email: true, tier: true },
      },
      documents: true,
    },
  });
}

/**
 * Approves a KYC submission and awards verification status.
 */
export async function approveKycSubmission(id: string) {
  const submission = await prisma.kycSubmission.findUnique({
    where: { id },
    include: { agency: { select: { id: true, name: true, email: true } } },
  });

  if (!submission) {
    throw new Error(`KYC submission ${id} not found`);
  }

  if (submission.status !== "SUBMITTED") {
    throw new Error(`KYC submission ${id} is already ${submission.status}`);
  }

  const updated = await prisma.kycSubmission.update({
    where: { id },
    data: {
      status: "APPROVED",
      reviewedAt: new Date(),
    },
    select: {
      id: true,
      status: true,
      reviewedAt: true,
      agencyId: true,
    },
  });

  queueEmail(
    submission.agency.email,
    "Your KYC verification has been approved",
    `Dear ${submission.agency.name},

Congratulations! Your KYC submission has been reviewed and approved. Your account is now fully verified.

Best regards,
The Platform Team`
  ).catch((err) =>
    console.error("[approveKycSubmission] failed to queue email:", err)
  );

  return updated;
}

/**
 * Rejects a KYC submission and stores the rejection reason.
 */
export async function rejectKycSubmission(id: string, reason: string) {
  const submission = await prisma.kycSubmission.findUnique({
    where: { id },
    include: { agency: { select: { id: true, name: true, email: true } } },
  });

  if (!submission) {
    throw new Error(`KYC submission ${id} not found`);
  }

  if (submission.status !== "SUBMITTED") {
    throw new Error(`KYC submission ${id} is already ${submission.status}`);
  }

  const updated = await prisma.kycSubmission.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason: reason,
      reviewedAt: new Date(),
    },
    select: {
      id: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      agencyId: true,
    },
  });

  queueEmail(
    submission.agency.email,
    "Action required: KYC verification rejected",
    `Dear ${submission.agency.name},

We have reviewed your KYC submission and unfortunately it has been rejected for the following reason:

${reason}

Please address the issue and resubmit your documents.

Best regards,
The Platform Team`
  ).catch((err) =>
    console.error("[rejectKycSubmission] failed to queue email:", err)
  );

  return updated;
}

/**
 * Returns emails from the queue.
 */
export async function listEmailQueue(
  statuses: EmailStatus[] = ["pending", "sent", "failed"]
) {
  return getEmailQueue({ status: statuses });
}

export { queueEmail };