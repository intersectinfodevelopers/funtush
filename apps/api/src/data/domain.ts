/**
 * ── The domain-verification option table (backend catch-up pass) ─────────────
 *
 * Same idea as `siteConfig.ts`: the pure, database-free facts a domain
 * connection depends on — the format an agency's typed-in domain must match,
 * and the exact records it needs to add at its registrar.
 *
 * Before this pass, `updateAgencyDomainService` wrote whatever string an
 * agency sent straight into `Agency.customDomain` with no format check and no
 * proof of ownership — an agency (or a typo) could point the platform at a
 * domain it doesn't control. This file is the format half of fixing that;
 * `lib/dnsVerification.ts` is the ownership half.
 *
 * ⚠️ This file must not import from `@funtush/database` or perform any I/O —
 * DNS lookups live in `lib/dnsVerification.ts`, which this file is imported
 * by but never imports back.
 */

import { siteBaseDomain } from "./staticPages";

export type DomainVerificationStatusId = "NONE" | "PENDING" | "VERIFIED";

/**
 * Bare registrable domain, no scheme/path — "example.com",
 * "trek.example.co.uk". Mirrors the frontend's own `isValidDomain` exactly,
 * so a value either side accepts is accepted on both.
 */
export function isValidDomain(value: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i.test(value.trim());
}

/** Lowercased, trimmed — domains are case-insensitive and copy-paste always
 * carries stray whitespace. */
export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase();
}

export interface DnsRecordInstruction {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
}

export interface DnsInstructions {
  /** Points the domain's traffic at this agency's site. */
  cname: DnsRecordInstruction;
  /** Proves the agency controls the domain — this is what `verifyDomain` checks. */
  txt: DnsRecordInstruction;
}

/**
 * The exact two records an agency must add, and the exact one
 * `verifyDomain` reads back.
 *
 * The CNAME points `www.{domain}` at the agency's own subdomain (not a bare
 * platform-wide host) — mirroring `siteOrigins()` in `staticPages.ts`, which
 * is the same reason a mapped custom domain never replaces the subdomain: an
 * agency's own staff have the subdomain bookmarked, and it has to keep
 * resolving to *this* agency specifically, not just "the platform."
 *
 * The TXT record's name is namespaced under `_funtush-verify` so it can never
 * collide with a DNS record the domain's owner already has for something
 * else, and its value is the random token generated when the domain was
 * connected — matching it back is the entire ownership proof.
 */
export function buildDnsInstructions(domain: string, slug: string, token: string): DnsInstructions {
  return {
    cname: { type: "CNAME", name: `www.${domain}`, value: `${slug}.${siteBaseDomain()}` },
    txt: { type: "TXT", name: `_funtush-verify.${domain}`, value: token },
  };
}

/** The hostname `verifyDomain` performs its TXT lookup against. */
export function verificationTxtHostname(domain: string): string {
  return `_funtush-verify.${domain}`;
}
