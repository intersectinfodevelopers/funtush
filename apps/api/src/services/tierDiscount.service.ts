import { db, Prisma, DiscountType, BillingCycle } from "@funtush/database";

/**
 * Admin-managed discount codes for subscription-tier pricing (monthly/annual
 * plan cost), distinct from `Coupon` (a trekker's booking discount). Real,
 * redeemable codes: creation, validation against a real tier price, and
 * redemption all live here.
 */

export class TierDiscountError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SELECT = {
  id: true,
  code: true,
  discountType: true,
  discountValue: true,
  appliesToTierId: true,
  appliesToTier: { select: { id: true, name: true } },
  billingCycle: true,
  maxRedemptions: true,
  timesRedeemed: true,
  validFrom: true,
  validUntil: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TierDiscountCodeSelect;

function normalizeCode(code: unknown): string {
  if (typeof code !== "string" || !code.trim()) {
    throw new TierDiscountError(400, "code is required");
  }
  return code.trim().toUpperCase();
}

function parseDiscountType(v: unknown): DiscountType {
  if (v !== "PERCENTAGE" && v !== "FIXED") {
    throw new TierDiscountError(400, "discountType must be PERCENTAGE or FIXED");
  }
  return v;
}

function parseBillingCycle(v: unknown): BillingCycle {
  if (v === undefined || v === null) return "BOTH";
  if (v !== "MONTHLY" && v !== "ANNUAL" && v !== "BOTH") {
    throw new TierDiscountError(400, "billingCycle must be MONTHLY, ANNUAL, or BOTH");
  }
  return v;
}

function parseDiscountValue(v: unknown, discountType: DiscountType): Prisma.Decimal {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new TierDiscountError(400, "discountValue must be a positive number");
  }
  if (discountType === "PERCENTAGE" && n > 100) {
    throw new TierDiscountError(400, "A percentage discount cannot exceed 100");
  }
  return new Prisma.Decimal(n);
}

function parseDate(v: unknown, label: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) throw new TierDiscountError(400, `${label} is not a valid date`);
  return d;
}

export async function listDiscountCodes() {
  return db.tierDiscountCode.findMany({
    select: { ...SELECT, _count: { select: { redemptions: true } } },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
}

export async function createDiscountCode(input: Record<string, unknown>) {
  const code = normalizeCode(input.code);
  const discountType = parseDiscountType(input.discountType);
  const discountValue = parseDiscountValue(input.discountValue, discountType);
  const billingCycle = parseBillingCycle(input.billingCycle);
  const validFrom = parseDate(input.validFrom, "validFrom");
  const validUntil = parseDate(input.validUntil, "validUntil");
  if (validFrom && validUntil && validFrom > validUntil) {
    throw new TierDiscountError(400, "validFrom must be before validUntil");
  }

  const appliesToTierId = input.appliesToTierId ? String(input.appliesToTierId) : null;
  if (appliesToTierId) {
    const tier = await db.subscriptionTier.findUnique({ where: { id: appliesToTierId } });
    if (!tier) throw new TierDiscountError(400, "appliesToTierId does not match a real tier");
  }

  const maxRedemptions =
    input.maxRedemptions === undefined || input.maxRedemptions === null || input.maxRedemptions === ""
      ? null
      : Number(input.maxRedemptions);
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    throw new TierDiscountError(400, "maxRedemptions must be a positive whole number, or omitted for unlimited");
  }

  try {
    return await db.tierDiscountCode.create({
      data: { code, discountType, discountValue, billingCycle, appliesToTierId, maxRedemptions, validFrom, validUntil },
      select: SELECT,
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
      throw new TierDiscountError(409, "That code already exists");
    }
    throw err;
  }
}

export async function updateDiscountCode(id: string, patch: Record<string, unknown>) {
  const existing = await db.tierDiscountCode.findUnique({ where: { id } });
  if (!existing) throw new TierDiscountError(404, "Discount code not found");

  const data: Prisma.TierDiscountCodeUpdateInput = {};
  if (patch.isActive !== undefined) {
    if (typeof patch.isActive !== "boolean") throw new TierDiscountError(400, "isActive must be a boolean");
    data.isActive = patch.isActive;
  }
  if (patch.validFrom !== undefined) data.validFrom = parseDate(patch.validFrom, "validFrom");
  if (patch.validUntil !== undefined) data.validUntil = parseDate(patch.validUntil, "validUntil");
  if (patch.maxRedemptions !== undefined) {
    const mr = patch.maxRedemptions === null || patch.maxRedemptions === "" ? null : Number(patch.maxRedemptions);
    if (mr !== null && (!Number.isInteger(mr) || mr < existing.timesRedeemed)) {
      throw new TierDiscountError(400, `maxRedemptions must be at least ${existing.timesRedeemed} (already redeemed) or omitted for unlimited`);
    }
    data.maxRedemptions = mr;
  }
  if (patch.discountValue !== undefined) {
    data.discountValue = parseDiscountValue(patch.discountValue, existing.discountType);
  }

  return db.tierDiscountCode.update({ where: { id }, data, select: SELECT });
}

export async function deleteDiscountCode(id: string) {
  const existing = await db.tierDiscountCode.findUnique({ where: { id } });
  if (!existing) throw new TierDiscountError(404, "Discount code not found");
  if (existing.timesRedeemed > 0) {
    throw new TierDiscountError(400, "This code has real redemptions on it — deactivate it instead of deleting so the history stays intact");
  }
  await db.tierDiscountCode.delete({ where: { id } });
}

export interface DiscountQuote {
  codeId: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  basePrice: number;
  amountOff: number;
  finalPrice: number;
  currency: "USD";
}

/** Validates a code against a real tier + billing cycle and prices it — no side effects. */
export async function quoteDiscountCode(
  rawCode: string,
  tierId: string,
  billingCycle: "MONTHLY" | "ANNUAL",
): Promise<DiscountQuote> {
  const code = normalizeCode(rawCode);
  const tier = await db.subscriptionTier.findUnique({ where: { id: tierId } });
  if (!tier) throw new TierDiscountError(404, "Subscription tier not found");

  const discount = await db.tierDiscountCode.findUnique({ where: { code } });
  if (!discount || !discount.isActive) throw new TierDiscountError(400, "Invalid or inactive discount code");

  const now = new Date();
  if (discount.validFrom && now < discount.validFrom) throw new TierDiscountError(400, "This code is not active yet");
  if (discount.validUntil && now > discount.validUntil) throw new TierDiscountError(400, "This code has expired");
  if (discount.maxRedemptions !== null && discount.timesRedeemed >= discount.maxRedemptions) {
    throw new TierDiscountError(400, "This code has reached its redemption limit");
  }
  if (discount.appliesToTierId && discount.appliesToTierId !== tierId) {
    throw new TierDiscountError(400, "This code does not apply to the selected plan");
  }
  if (discount.billingCycle !== "BOTH" && discount.billingCycle !== billingCycle) {
    throw new TierDiscountError(400, `This code only applies to ${discount.billingCycle.toLowerCase()} billing`);
  }

  const basePriceDecimal = billingCycle === "ANNUAL" ? tier.annualPrice : tier.monthlyPrice;
  if (basePriceDecimal === null) throw new TierDiscountError(400, "This plan has no annual price configured");
  const basePrice = Number(basePriceDecimal);

  const amountOff =
    discount.discountType === "PERCENTAGE"
      ? Math.min(basePrice, (basePrice * Number(discount.discountValue)) / 100)
      : Math.min(basePrice, Number(discount.discountValue));

  return {
    codeId: discount.id,
    code: discount.code,
    discountType: discount.discountType,
    discountValue: Number(discount.discountValue),
    basePrice,
    amountOff: Math.round(amountOff * 100) / 100,
    finalPrice: Math.round((basePrice - amountOff) * 100) / 100,
    currency: "USD",
  };
}

/**
 * Race-safe redemption: `maxRedemptions` is read fresh inside the same
 * transaction, and the conditional `updateMany` uses it as a literal bound in
 * the WHERE clause — Postgres re-evaluates that predicate against the row's
 * committed value at UPDATE time (row-locked), so two concurrent redemptions
 * racing for the last slot can't both succeed.
 */
export async function redeemDiscountCode(codeId: string, agencyId: string, amountOff: number) {
  return db.$transaction(async (tx) => {
    const current = await tx.tierDiscountCode.findUnique({ where: { id: codeId } });
    if (!current || !current.isActive) throw new TierDiscountError(400, "This code is no longer redeemable");

    const updated = await tx.tierDiscountCode.updateMany({
      where: {
        id: codeId,
        isActive: true,
        ...(current.maxRedemptions !== null ? { timesRedeemed: { lt: current.maxRedemptions } } : {}),
      },
      data: { timesRedeemed: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new TierDiscountError(400, "This code is no longer redeemable");
    }
    return tx.tierDiscountRedemption.create({
      data: { discountCodeId: codeId, agencyId, amountOff: new Prisma.Decimal(amountOff) },
    });
  });
}
