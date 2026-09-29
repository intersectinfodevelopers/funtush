import crypto from "crypto";

/** Constant-time string equality. `===` on a signature leaks, byte by byte, how much of a guess was right. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export type GatewayType = "stripe" | "khalti" | "esewa" | "connectips";

export interface VerifiedPayment {
  gateway: GatewayType;
  bookingId: string;
  agencyId: string;
  amountPaid: number;
  transactionId: string;
}

// Stripe
export function verifyStripeSignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean {
  const parts = Object.fromEntries(
    signature.split(",").map((p) => p.split("="))
  ) as { t?: string; v1?: string };

  if (!parts.t || !parts.v1) return false;

  // Reject stale webhooks (>5 min old) to prevent replay
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (age > 300) return false;

  const signedPayload = `${parts.t}.${rawBody.toString()}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  // timingSafeEqual THROWS on unequal lengths — a malformed header used to become a 500
  return safeEqual(expected, parts.v1);
}

// Khalti
export async function verifyKhaltiPayment(
  pidx: string
): Promise<{ amount: number; transactionId: string } | null> {
  const res = await fetch("https://a.khalti.com/api/v2/epayment/lookup/", {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.KHALTI_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pidx }),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    status: string;
    total_amount: number;
    pidx: string;
  };

  if (data.status !== "Completed") return null;

  return {
    amount: data.total_amount / 100,
    transactionId: data.pidx,
  };
}
// eSewa
export function verifyEsewaSignature(
  message: string,
  receivedSignature: string,
  secret: string
): boolean {
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("base64");
  return typeof receivedSignature === "string" && safeEqual(hmac, receivedSignature);
}

// ConnectIPS
export function verifyConnectIPSSignature(
  message: string,
  receivedSignature: string,
  secret: string
): boolean {
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("base64");
  return typeof receivedSignature === "string" && safeEqual(hmac, receivedSignature);
}
