// ─────────────────────────────────────────────────────────────────────────────
// Custom-domain onboarding + DNS verification (Concept doc §4).
//
// Flow: agency (paid tier) sets a domain → gets a TXT record to publish →
// verify does a live DNS lookup → on success status VERIFIED and the domain is
// copied onto Agency.customDomain. resolveTenant / getTenantByCustomDomain only
// route a request to an agency when the mapping is VERIFIED.
// ─────────────────────────────────────────────────────────────────────────────
import { promises as dns } from "dns";
import { randomBytes } from "crypto";
import { db } from "@funtush/database";
import { cacheDel } from "./redis.service.js";

export class CustomDomainError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "CustomDomainError";
  }
}

const CNAME_TARGET = process.env.SITE_BASE_DOMAIN || "sites.funtush.io";
const TXT_PREFIX = "_funtush-verify";
const TXT_VALUE = (token: string) => `funtush-domain-verification=${token}`;

// hostname per RFC 1123, 1–253 chars, at least one dot, no leading/trailing dash.
const DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;
const BLOCKED_SUFFIXES = ["funtush.com", "funtush.io", "funtush.app", "localhost"];

function normalizeDomain(raw: string): string {
  let d = (raw || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  return d;
}

function assertValidDomain(domain: string) {
  if (!DOMAIN_RE.test(domain)) {
    throw new CustomDomainError(400, "Enter a valid domain, e.g. book.myagency.com");
  }
  if (BLOCKED_SUFFIXES.some((s) => domain === s || domain.endsWith(`.${s}`))) {
    throw new CustomDomainError(400, "That domain is reserved.");
  }
}

function dnsInstructions(domain: string, token: string) {
  return {
    cname: { host: domain, type: "CNAME", value: CNAME_TARGET },
    txt: { host: `${TXT_PREFIX}.${domain}`, type: "TXT", value: TXT_VALUE(token) },
    note: "Add both records at your DNS provider, then click Verify. Propagation can take a few minutes to a few hours.",
  };
}

function toApi(m: {
  domain: string;
  status: string;
  verificationToken: string;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    domain: m.domain,
    status: m.status,
    verifiedAt: m.verifiedAt,
    lastCheckedAt: m.lastCheckedAt,
    lastError: m.lastError,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    dns: dnsInstructions(m.domain, m.verificationToken),
  };
}

async function requireCustomDomainTier(agencyId: string) {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { id: true, tier: { select: { customDomainEnabled: true } } },
  });
  if (!agency) throw new CustomDomainError(404, "Agency not found");
  if (!agency.tier?.customDomainEnabled) {
    throw new CustomDomainError(403, "Custom domains are available on higher tiers. Upgrade to enable.");
  }
}

/** Current mapping (with DNS instructions), or null. */
export async function getDomainMapping(agencyId: string) {
  const m = await db.domainMapping.findUnique({ where: { agencyId } });
  return m ? toApi(m) : null;
}

/** Set (or replace) the agency's custom domain. Resets verification. */
export async function setCustomDomain(agencyId: string, rawDomain: string) {
  await requireCustomDomainTier(agencyId);
  const domain = normalizeDomain(rawDomain);
  assertValidDomain(domain);

  const clash = await db.domainMapping.findUnique({ where: { domain }, select: { agencyId: true } });
  if (clash && clash.agencyId !== agencyId) {
    throw new CustomDomainError(409, "That domain is already claimed by another agency.");
  }

  const existing = await db.domainMapping.findUnique({ where: { agencyId } });
  const verificationToken = randomBytes(16).toString("hex");

  const m = await db.domainMapping.upsert({
    where: { agencyId },
    create: { agencyId, domain, verificationToken },
    update: {
      domain,
      verificationToken,
      status: "PENDING",
      verifiedAt: null,
      lastError: null,
      lastCheckedAt: null,
    },
  });

  // A domain (or the agency's own record) changed — drop any cached routing and
  // the old customDomain on the agency until re-verified.
  if (existing?.domain && existing.domain !== domain) await cacheDel(`tenant:domain:${existing.domain}`);
  await cacheDel(`tenant:domain:${domain}`);
  if (existing?.status === "VERIFIED") {
    await db.agency.update({ where: { id: agencyId }, data: { customDomain: null } });
  }

  return toApi(m);
}

export interface VerifyOpts {
  /** Injectable for tests. Defaults to dns.resolveTxt. */
  lookupTxt?: (name: string) => Promise<string[][]>;
}

/** Run a live DNS check. VERIFIED on success; FAILED (with lastError) otherwise. */
export async function verifyCustomDomain(agencyId: string, opts: VerifyOpts = {}) {
  const m = await db.domainMapping.findUnique({ where: { agencyId } });
  if (!m) throw new CustomDomainError(404, "No custom domain set for this agency.");

  const lookupTxt = opts.lookupTxt ?? ((name: string) => dns.resolveTxt(name));
  const name = `${TXT_PREFIX}.${m.domain}`;
  const expected = TXT_VALUE(m.verificationToken);

  let ok = false;
  let error: string | null = null;
  try {
    const records = await lookupTxt(name);
    const flat = records.map((chunks) => chunks.join("").trim());
    ok = flat.includes(expected);
    if (!ok) error = `TXT record ${name} not found or does not match. Saw: ${flat.join(" | ") || "(none)"}`;
  } catch (e) {
    error = e instanceof Error ? e.message : "DNS lookup failed";
  }

  const updated = await db.domainMapping.update({
    where: { agencyId },
    data: {
      status: ok ? "VERIFIED" : "FAILED",
      verifiedAt: ok ? new Date() : m.verifiedAt,
      lastCheckedAt: new Date(),
      lastError: ok ? null : error,
    },
  });

  await db.agency.update({
    where: { id: agencyId },
    data: { customDomain: ok ? m.domain : null },
  });
  await cacheDel(`tenant:domain:${m.domain}`);

  return toApi(updated);
}

export async function removeCustomDomain(agencyId: string) {
  const m = await db.domainMapping.findUnique({ where: { agencyId } });
  if (!m) return { removed: false };
  await db.domainMapping.delete({ where: { agencyId } });
  await db.agency.update({ where: { id: agencyId }, data: { customDomain: null } }).catch(() => {});
  await cacheDel(`tenant:domain:${m.domain}`);
  return { removed: true };
}
