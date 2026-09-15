/**
 * ── Real DNS ownership verification (backend catch-up pass) ──────────────────
 *
 * One function: does a TXT record at `_funtush-verify.{domain}` contain the
 * exact token this agency was issued? That's the whole proof of ownership —
 * only someone who can edit the domain's DNS (which means owning or
 * controlling the domain) can make that record say anything at all.
 *
 * Uses Node's built-in `dns/promises` — no external service, no API key, and
 * nothing to mock away in production. Tests mock this module directly
 * (`vi.mock("../lib/dnsVerification")`) rather than mocking DNS itself, the
 * same way `cdn.ts`/`isr.ts` are mocked wholesale in
 * `regenerationTriggers.test.ts` instead of mocking `fetch`.
 *
 * **Never throws.** A failed or empty lookup is a completely ordinary state
 * for a domain an agency just connected — DNS can take up to 48 hours to
 * propagate — so "not verified yet" is a value this returns, not an error a
 * caller has to catch. The only real failure mode (a network-down sandbox, a
 * resolver outage) collapses to the same "not verified yet" outcome, which is
 * also the honest answer: from here, an unreachable record and an absent one
 * look identical, and both mean "can't confirm ownership right now."
 */

import { promises as dns } from "node:dns";
import { verificationTxtHostname } from "../data/domain";

export interface DnsVerificationResult {
  verified: boolean;
  /** Human-readable, safe to show directly in the dashboard. */
  detail: string;
}

/**
 * `dns.resolveTxt` returns each record as an array of chunks (long TXT
 * values are split by the DNS spec at 255 bytes) — joined back into one
 * string before comparing, so a token that happens to be long is not
 * silently un-matchable.
 */
export async function verifyDomainOwnership(domain: string, token: string): Promise<DnsVerificationResult> {
  const hostname = verificationTxtHostname(domain);

  let records: string[][];
  try {
    records = await dns.resolveTxt(hostname);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN") {
      return { verified: false, detail: `No TXT record found at ${hostname} yet.` };
    }
    return { verified: false, detail: "Could not look up DNS records right now. Try again shortly." };
  }

  const found = records.some((chunks) => chunks.join("").trim() === token);
  return found
    ? { verified: true, detail: `Verified via TXT record at ${hostname}.` }
    : { verified: false, detail: `Found a TXT record at ${hostname}, but it doesn't match your token.` };
}
