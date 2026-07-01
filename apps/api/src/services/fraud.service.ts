/**
 * Fraud review queue — business logic.
 *
 * Same shape as kyc.service.ts: a queue of PENDING flags an admin either
 * confirms (permanent ban + blocklist the account's fingerprint/IP/email) or
 * dismisses (clear the flag, reset the risk profile, notify the agency), plus
 * a read-only registry of every permanently banned account.
 *
 * Lives under src/services/.
 */

import { prisma } from "../packages/database/prisma.js";
import { queueEmail } from "../lib/emailQueue.js";

// RED is the strongest signal; queue is sorted RED -> ORANGE -> YELLOW.
const SIGNAL_RANK: Record<string, number> = { RED: 0, ORANGE: 1, YELLOW: 2 };

const agencySummary = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
} as const;

/**
 * All PENDING fraud flags, strongest signal first. Each item carries the
 * account name/email, the flags that fired, registration date, and the
 * evidence summary.
 */
export async function getFraudQueue() {
  const flags = await prisma.fraudFlag.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { agency: { select: agencySummary } },
  });

  // Prisma can't order by our custom RED/ORANGE/YELLOW priority, so sort in JS.
  return [...flags].sort(
    (a, b) => (SIGNAL_RANK[a.signal] ?? 99) - (SIGNAL_RANK[b.signal] ?? 99)
  );
}

/**
 * Confirm a flag: permanently ban the account and add its fingerprint, IP, and
 * email to the blocklist. Everything happens in one transaction so a partial
 * ban can't leave the account active-but-blocklisted (or vice versa).
 */
export async function confirmFraud(id: string, reason?: string) {
  const flag = await prisma.fraudFlag.findUnique({
    where: { id },
    include: { agency: { select: agencySummary } },
  });
  if (!flag) throw new Error("Fraud flag not found");
  if (flag.status !== "PENDING") {
    throw new Error(`Fraud flag already ${flag.status.toLowerCase()}`);
  }

  const banReason = reason?.trim() || flag.evidenceSummary || "Confirmed fraud";

  // Blocklist rows for whichever signals we actually captured on the flag.
  const blocklistRows = [
    flag.fingerprint ? { type: "FINGERPRINT" as const, value: flag.fingerprint } : null,
    flag.ip ? { type: "IP" as const, value: flag.ip } : null,
    flag.email ? { type: "EMAIL" as const, value: flag.email } : null,
  ]
    .filter((r): r is { type: "FINGERPRINT" | "IP" | "EMAIL"; value: string } => r !== null)
    .map((r) => ({ ...r, reason: banReason, agencyId: flag.agencyId }));

  const [updatedFlag] = await prisma.$transaction([
    prisma.fraudFlag.update({
      where: { id },
      data: { status: "CONFIRMED", reviewedAt: new Date() },
    }),
    prisma.agency.update({
      where: { id: flag.agencyId },
      data: { status: "BANNED", bannedAt: new Date(), banReason },
    }),
    // Idempotent: skip any (type, value) already on the blocklist.
    prisma.blocklistEntry.createMany({ data: blocklistRows, skipDuplicates: true }),
  ]);

  return updatedFlag;
}

/**
 * Dismiss a flag: clear it, reset the account's risk profile, and let the
 * agency know their account is in good standing.
 */
export async function dismissFraud(id: string) {
  const flag = await prisma.fraudFlag.findUnique({
    where: { id },
    include: { agency: { select: agencySummary } },
  });
  if (!flag) throw new Error("Fraud flag not found");
  if (flag.status !== "PENDING") {
    throw new Error(`Fraud flag already ${flag.status.toLowerCase()}`);
  }

  const [updatedFlag] = await prisma.$transaction([
    prisma.fraudFlag.update({
      where: { id },
      data: { status: "DISMISSED", reviewedAt: new Date() },
    }),
    prisma.agency.update({
      where: { id: flag.agencyId },
      data: { riskScore: 0 },
    }),
  ]);

  // Fire-and-forget, same pattern as the KYC emails.
  void queueEmail(
    flag.agency.email,
    "Your account has been cleared",
    `Good news — a recent security flag on ${flag.agency.name} has been reviewed and dismissed. No action is needed on your part.`
  );

  return updatedFlag;
}

/** Every permanently banned account, with ban reason and timestamp. */
export async function getBanRegistry() {
  return prisma.agency.findMany({
    where: { status: "BANNED" },
    orderBy: { bannedAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      bannedAt: true,
      banReason: true,
    },
  });
}