import { db } from "@funtush/database";
import { generateEsewaForm, verifyEsewaPayment } from "../utils/esewa";
import { initiateKhalti, lookupKhalti } from "../utils/khalti";
import { notificationService } from "./notificationService";
import { quoteDiscountCode, redeemDiscountCode, TierDiscountError } from "./tierDiscount.service";

/** Plan prices are listed in USD; the Nepali gateways charge NPR. Rate is fixed by config so the price shown is the price charged. */
export function usdToNpr(usd: number): number {
  const rate = Number(process.env.USD_NPR_RATE);
  return Math.ceil(usd * (Number.isFinite(rate) && rate > 0 ? rate : 140));
}

export class PaymentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A paid, different-from-current plan. (Free plans and re-buying the current plan are refused.) */
async function payableTier(agencyId: string, tierId: unknown) {
  if (typeof tierId !== "string" || !tierId) throw new PaymentError(400, "Choose a plan.");
  const [tier, agency] = await Promise.all([
    db.subscriptionTier.findUnique({ where: { id: tierId } }),
    db.agency.findUnique({ where: { id: agencyId }, select: { tierId: true } }),
  ]);
  if (!tier) throw new PaymentError(404, "That plan doesn't exist.");
  if (Number(tier.monthlyPrice) <= 0) throw new PaymentError(400, "That plan is free — there's nothing to pay.");
  if (agency?.tierId === tier.id) throw new PaymentError(400, "You're already on that plan.");
  return tier;
}

/** Applies an optional discount code to a tier's monthly price. Invalid/missing codes are surfaced as a PaymentError, not silently ignored, so an agency knows their code didn't work rather than being charged full price unexpectedly. */
async function priceMonthly(tier: { id: string; monthlyPrice: unknown }, discountCode: unknown) {
  const base = Number(tier.monthlyPrice);
  if (discountCode === undefined || discountCode === null || (typeof discountCode === "string" && !discountCode.trim())) {
    return { usdAmount: base, discountCodeId: null as string | null, amountOffUsd: null as number | null };
  }
  if (typeof discountCode !== "string") throw new PaymentError(400, "Invalid discount code.");
  try {
    const quote = await quoteDiscountCode(discountCode, tier.id, "MONTHLY");
    return { usdAmount: quote.finalPrice, discountCodeId: quote.codeId, amountOffUsd: quote.amountOff };
  } catch (err) {
    if (err instanceof TierDiscountError) throw new PaymentError(err.status, err.message);
    throw err;
  }
}

/** Records real usage against the code — called only after a gateway has confirmed the payment actually succeeded, never at initiate. */
async function finalizeDiscount(agencyId: string, discountCodeId: string | null, amountOffUsd: number | null) {
  if (!discountCodeId) return;
  try {
    await redeemDiscountCode(discountCodeId, agencyId, amountOffUsd ?? 0);
  } catch (err) {
    console.error("[finalizeDiscount] failed to record redemption (payment already succeeded):", err);
  }
}

async function upgrade(agencyId: string, tierId: string, provider: string, amount: number) {
  await db.agency.update({ where: { id: agencyId }, data: { tierId } });
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { email: true, name: true } });
  if (!agency) return;
  try {
    await notificationService.sendEmailNotification(agency.email, "subscription_payment_received", { agencyName: agency.name, amount, currency: "NPR", provider });
  } catch (err) {
    console.error("[Notification] subscription notify error:", (err as Error).message);
  }
}

async function failed(agencyId: string, provider: string) {
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { email: true, name: true } });
  if (!agency) return;
  try {
    await notificationService.sendEmailNotification(agency.email, "subscription_payment_failed", { agencyName: agency.name, provider });
  } catch (err) {
    console.error("[Notification] subscription notify error:", (err as Error).message);
  }
}

/* ── eSewa ─────────────────────────────────────────────────────────────── */

export async function initiateEsewaPayment(agencyId: string, tierId: unknown, discountCode?: unknown) {
  const tier = await payableTier(agencyId, tierId);
  const priced = await priceMonthly(tier, discountCode);
  const amount = usdToNpr(priced.usdAmount);
  const tx = await db.esewaTransaction.create({
    data: { agencyId, tierId: tier.id, amount, status: "pending", discountCodeId: priced.discountCodeId, discountAmountOff: priced.amountOffUsd },
  });
  return { transactionId: tx.id, amount, currency: "NPR", form: generateEsewaForm(tx.id, amount) };
}

export async function verifyAndCompleteEsewaPayment(refId: unknown, transactionId: unknown, agencyId: string) {
  if (typeof refId !== "string" || !/^[A-Za-z0-9-]{3,40}$/.test(refId)) throw new PaymentError(400, "Invalid payment reference.");
  if (typeof transactionId !== "string" || !transactionId) throw new PaymentError(400, "Missing transaction.");
  // Must be THIS agency's own, still-pending transaction; the status flip is atomic so it can only be settled once.
  const tx = await db.esewaTransaction.findFirst({ where: { id: transactionId, agencyId } });
  if (!tx) throw new PaymentError(404, "Transaction not found.");
  if (tx.status === "success") return tx;
  const claimed = await db.esewaTransaction.updateMany({ where: { id: tx.id, status: "pending" }, data: { status: "verifying" } });
  if (claimed.count === 0) throw new PaymentError(409, "This payment is already being processed.");

  const ok = await verifyEsewaPayment(refId, tx.id, tx.amount);
  if (!ok) {
    await db.esewaTransaction.update({ where: { id: tx.id }, data: { status: "failed" } });
    await failed(agencyId, "eSewa");
    throw new PaymentError(400, "eSewa could not confirm this payment.");
  }
  const done = await db.esewaTransaction.update({ where: { id: tx.id }, data: { status: "success", esewaRefId: refId, verifiedAt: new Date() } });
  await upgrade(agencyId, tx.tierId, "eSewa", tx.amount);
  await finalizeDiscount(agencyId, tx.discountCodeId, tx.discountAmountOff);
  return done;
}

/* ── Khalti ────────────────────────────────────────────────────────────── */

export async function initiateKhaltiPayment(agencyId: string, tierId: unknown, discountCode?: unknown) {
  const tier = await payableTier(agencyId, tierId);
  const priced = await priceMonthly(tier, discountCode);
  const amount = usdToNpr(priced.usdAmount);
  const tx = await db.khaltiTransaction.create({
    data: { agencyId, tierId: tier.id, amount, status: "pending", discountCodeId: priced.discountCodeId, discountAmountOff: priced.amountOffUsd },
  });
  try {
    const { pidx, paymentUrl } = await initiateKhalti({ transactionId: tx.id, amountNpr: amount, name: `Funtush ${tier.name} plan` });
    await db.khaltiTransaction.update({ where: { id: tx.id }, data: { khaltiToken: pidx } });
    return { transactionId: tx.id, amount, currency: "NPR", redirectUrl: paymentUrl };
  } catch (err) {
    await db.khaltiTransaction.update({ where: { id: tx.id }, data: { status: "failed" } });
    throw new PaymentError(502, (err as Error).message);
  }
}

export async function verifyAndCompleteKhaltiPayment(pidx: unknown, transactionId: unknown, agencyId: string) {
  if (typeof pidx !== "string" || !/^[A-Za-z0-9]{6,64}$/.test(pidx)) throw new PaymentError(400, "Invalid payment reference.");
  if (typeof transactionId !== "string" || !transactionId) throw new PaymentError(400, "Missing transaction.");
  const tx = await db.khaltiTransaction.findFirst({ where: { id: transactionId, agencyId } });
  if (!tx) throw new PaymentError(404, "Transaction not found.");
  if (tx.status === "success") return tx;
  // The reference must be the one WE got from Khalti when starting this very payment.
  if (tx.khaltiToken !== pidx) throw new PaymentError(400, "That payment doesn't belong to this transaction.");
  const claimed = await db.khaltiTransaction.updateMany({ where: { id: tx.id, status: "pending" }, data: { status: "verifying" } });
  if (claimed.count === 0) throw new PaymentError(409, "This payment is already being processed.");

  const look = await lookupKhalti(pidx);
  const good = look && look.status === "Completed" && look.totalPaisa === Math.round(tx.amount * 100);
  if (!good) {
    // "Pending"/"Initiated" means the payer hasn't finished: keep it retryable rather than burning it.
    const retryable = look && ["Pending", "Initiated"].includes(look.status);
    await db.khaltiTransaction.update({ where: { id: tx.id }, data: { status: retryable ? "pending" : "failed" } });
    if (!retryable) await failed(agencyId, "Khalti");
    throw new PaymentError(400, retryable ? "Your Khalti payment isn't complete yet." : "Khalti could not confirm this payment.");
  }
  const done = await db.khaltiTransaction.update({ where: { id: tx.id }, data: { status: "success", verifiedAt: new Date() } });
  await upgrade(agencyId, tx.tierId, "Khalti", tx.amount);
  await finalizeDiscount(agencyId, tx.discountCodeId, tx.discountAmountOff);
  return done;
}
