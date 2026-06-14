import crypto from "crypto";

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
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
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
  return hmac === receivedSignature;
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
  return hmac === receivedSignature;
}
