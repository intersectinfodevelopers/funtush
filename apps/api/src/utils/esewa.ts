/**
 * eSewa (v1 ePay) helpers.
 *
 * Flow: the browser POSTs a form to `${base}/epay/main`; eSewa redirects the payer to `su` with
 * `?oid=<pid>&amt=<amount>&refId=<reference>`; our server then confirms the payment by calling
 * `${base}/epay/transrec` (amt + rid + pid + scd) and only trusts a "Success" answer.
 */
export interface EsewaConfig {
  merchantCode: string;
  /** e.g. https://uat.esewa.com.np (sandbox) or https://esewa.com.np (live). */
  baseUrl: string;
}

export function getEsewaConfig(): EsewaConfig {
  const merchantCode = process.env.ESEWA_MERCHANT_CODE;
  if (!merchantCode) throw new Error("eSewa credentials not configured");
  const baseUrl = (process.env.ESEWA_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://esewa.com.np" : "https://uat.esewa.com.np")).replace(/\/+$/, "");
  return { merchantCode, baseUrl };
}

/** Where eSewa/Khalti send the payer back to: a funtush-frontend page under the dashboard. */
export function billingReturnBase(): string {
  return (process.env.BILLING_RETURN_URL ?? `${process.env.FRONTEND_URL ?? "http://localhost:3001"}/dashboard/billing/return`).replace(/\/+$/, "");
}

/**
 * The form the browser submits to eSewa. `pid` MUST be unique per payment (we use our transaction id): eSewa binds
 * the reference it issues to that pid, so the same reference can never confirm a different transaction.
 * The transaction id travels in the URL PATH — eSewa appends its own query string to `su`/`fu`.
 */
export function generateEsewaForm(transactionId: string, amount: number) {
  const { merchantCode, baseUrl } = getEsewaConfig();
  const ret = billingReturnBase();
  return {
    action: `${baseUrl}/epay/main`,
    fields: {
      amt: String(amount),
      psc: "0",
      pdc: "0",
      txAmt: "0",
      tAmt: String(amount),
      pid: transactionId,
      scd: merchantCode,
      su: `${ret}/esewa/${encodeURIComponent(transactionId)}`,
      fu: `${ret}/failed/${encodeURIComponent(transactionId)}`,
    },
  };
}

export async function verifyEsewaPayment(refId: string, transactionId: string, amount: number): Promise<boolean> {
  const { merchantCode, baseUrl } = getEsewaConfig();
  try {
    const qs = new URLSearchParams({ amt: String(amount), rid: refId, pid: transactionId, scd: merchantCode });
    const res = await fetch(`${baseUrl}/epay/transrec?${qs.toString()}`, { method: "GET" });
    if (!res.ok) return false;
    const xml = await res.text();
    return /<response_code>\s*Success\s*<\/response_code>/i.test(xml);
  } catch (err) {
    console.error("eSewa verification error:", (err as Error).message);
    return false;
  }
}
