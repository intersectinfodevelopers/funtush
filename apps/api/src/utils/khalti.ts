import { billingReturnBase } from "./esewa";

/**
 * Khalti ePayment (redirect) helpers.
 *
 * Flow: we ask Khalti to start a payment (`/epayment/initiate/`) and get a `pidx` + `payment_url`; the payer pays on
 * Khalti and is returned to `return_url` with `?pidx=…&status=…`; our server then asks Khalti what really happened
 * (`/epayment/lookup/`) and only trusts a "Completed" answer for the exact amount.
 */
export interface KhaltiConfig {
  secretKey: string;
  /** https://dev.khalti.com/api/v2 (sandbox) or https://khalti.com/api/v2 (live). */
  baseUrl: string;
}

export function getKhaltiConfig(): KhaltiConfig {
  const secretKey = process.env.KHALTI_SECRET_KEY;
  if (!secretKey) throw new Error("Khalti credentials not configured");
  const baseUrl = (process.env.KHALTI_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://khalti.com/api/v2" : "https://dev.khalti.com/api/v2")).replace(/\/+$/, "");
  return { secretKey, baseUrl };
}

export async function initiateKhalti(input: { transactionId: string; amountNpr: number; name: string }): Promise<{ pidx: string; paymentUrl: string }> {
  const { secretKey, baseUrl } = getKhaltiConfig();
  const ret = billingReturnBase();
  const res = await fetch(`${baseUrl}/epayment/initiate/`, {
    method: "POST",
    headers: { Authorization: `Key ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      return_url: `${ret}/khalti/${encodeURIComponent(input.transactionId)}`,
      website_url: new URL(ret).origin,
      amount: Math.round(input.amountNpr * 100), // paisa
      purchase_order_id: input.transactionId,
      purchase_order_name: input.name,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { pidx?: string; payment_url?: string };
  if (!res.ok || !data.pidx || !data.payment_url) throw new Error("Khalti could not start the payment. Please try again.");
  return { pidx: data.pidx, paymentUrl: data.payment_url };
}

export async function lookupKhalti(pidx: string): Promise<{ status: string; totalPaisa: number } | null> {
  const { secretKey, baseUrl } = getKhaltiConfig();
  try {
    const res = await fetch(`${baseUrl}/epayment/lookup/`, { method: "POST", headers: { Authorization: `Key ${secretKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ pidx }) });
    if (!res.ok) return null;
    const d = (await res.json()) as { status?: string; total_amount?: number };
    return { status: String(d.status ?? ""), totalPaisa: Number(d.total_amount ?? 0) };
  } catch (err) {
    console.error("Khalti lookup error:", (err as Error).message);
    return null;
  }
}
