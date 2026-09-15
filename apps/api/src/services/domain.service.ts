/**
 * ── Domain & publish service (backend catch-up pass) ──────────────────────────
 *
 * Owns everything behind the free subdomain (always on, informational only —
 * there is nothing to configure), custom domain connection + ownership
 * verification, and the publish/unpublish switch.
 *
 * Before this pass, `updateAgencyDomainService` wrote any string straight
 * into `Agency.customDomain` with no format check, no proof the agency
 * controls the domain, and returned three lines of hardcoded, non-agency-
 * specific "DNS instructions" pointing at the literal string `"your-app.com"`.
 * This file replaces it with the same tier-gated, verified, per-agency shape
 * every other domain screen in this pass uses.
 *
 * Everything here is keyed by `agencyId` from the session (Backend Guide
 * §4) — the paid-tier gate is enforced by the `isPaidTier` middleware at the
 * route layer, a whole-endpoint gate rather than a per-field one, because
 * connecting a custom domain isn't a screen with some paid and some free
 * fields the way Day 1's colour picker is.
 */

import crypto from "node:crypto";
import { db } from "@funtush/database";
import { httpError } from "../utils/httpError";
import {
  buildDnsInstructions,
  normalizeDomain,
  type DnsInstructions,
  type DomainVerificationStatusId,
} from "../data/domain";
import { verifyDomainOwnership } from "../lib/dnsVerification";

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface DomainSettings {
  /** The free `{subdomain}.funtush.io` — always on, every tier, never removed
   * even once a custom domain is verified (Backend Guide §4's "two live
   * caches" reasoning in `staticPages.ts` applies here too: an agency's own
   * staff have the subdomain bookmarked). */
  subdomain: string;
  customDomain: string | null;
  status: DomainVerificationStatusId;
  verifiedAt: Date | null;
  /** `null` when no domain is connected — nothing to instruct. */
  dnsInstructions: DnsInstructions | null;
  published: boolean;
  publishedAt: Date | null;
}

interface AgencyDomainRow {
  slug: string;
  customDomain: string | null;
  customDomainStatus: DomainVerificationStatusId;
  customDomainVerificationToken: string | null;
  customDomainVerifiedAt: Date | null;
  publishedAt: Date | null;
}

const DOMAIN_SELECT = {
  slug: true,
  customDomain: true,
  customDomainStatus: true,
  customDomainVerificationToken: true,
  customDomainVerifiedAt: true,
  publishedAt: true,
} as const;

/** Read the agency row this module needs, or 404. */
async function getAgencyDomainRow(agencyId: string): Promise<AgencyDomainRow> {
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: DOMAIN_SELECT });
  if (!agency) throw httpError(404, "Agency not found");
  return agency as AgencyDomainRow;
}

function toSettings(row: AgencyDomainRow): DomainSettings {
  return {
    subdomain: row.slug,
    customDomain: row.customDomain,
    status: row.customDomainStatus,
    verifiedAt: row.customDomainVerifiedAt,
    dnsInstructions:
      row.customDomain && row.customDomainVerificationToken
        ? buildDnsInstructions(row.customDomain, row.slug, row.customDomainVerificationToken)
        : null,
    published: row.publishedAt !== null,
    publishedAt: row.publishedAt,
  };
}

/* ── 1. Reads ────────────────────────────────────────────────────────────── */

export async function getDomainSettings(agencyId: string): Promise<DomainSettings> {
  return toSettings(await getAgencyDomainRow(agencyId));
}

/* ── 2. Connect / disconnect ─────────────────────────────────────────────── */

/**
 * Connect (or replace) a custom domain.
 *
 * A fresh token every time, even when the domain string is unchanged — an
 * agency that disconnects and reconnects the same domain gets a new proof
 * requirement rather than silently trusting a TXT record that might still be
 * sitting in its DNS from months ago pointing at a token nobody re-checked.
 */
export async function connectDomain(agencyId: string, domainInput: string): Promise<DomainSettings> {
  const domain = normalizeDomain(domainInput);
  const token = crypto.randomBytes(16).toString("hex");

  const updated = await db.agency.update({
    where: { id: agencyId },
    data: {
      customDomain: domain,
      customDomainStatus: "PENDING",
      customDomainVerificationToken: token,
      customDomainVerifiedAt: null,
    },
    select: DOMAIN_SELECT,
  });

  return toSettings(updated as AgencyDomainRow);
}

export async function disconnectDomain(agencyId: string): Promise<DomainSettings> {
  const updated = await db.agency.update({
    where: { id: agencyId },
    data: {
      customDomain: null,
      customDomainStatus: "NONE",
      customDomainVerificationToken: null,
      customDomainVerifiedAt: null,
    },
    select: DOMAIN_SELECT,
  });

  return toSettings(updated as AgencyDomainRow);
}

/* ── 3. Verification ─────────────────────────────────────────────────────── */

export interface VerifyDomainResult {
  settings: DomainSettings;
  verified: boolean;
  detail: string;
}

/**
 * Re-check ownership against live DNS.
 *
 * A failed check **downgrades an already-`VERIFIED`** domain back to
 * `PENDING` rather than leaving the stale state in place — the status has to
 * reflect what DNS says *right now*, matching this codebase's "zero
 * downtime, never stale" thinking elsewhere (see `regeneration.service.ts`'s
 * file header). `customDomainVerifiedAt` is left untouched on a failed
 * re-check, though, so "last known good" survives a record that flickers or
 * gets accidentally removed for a moment.
 */
export async function verifyDomain(agencyId: string): Promise<VerifyDomainResult> {
  const row = await getAgencyDomainRow(agencyId);

  if (!row.customDomain || !row.customDomainVerificationToken) {
    throw httpError(400, "Connect a domain before verifying it.");
  }

  const result = await verifyDomainOwnership(row.customDomain, row.customDomainVerificationToken);

  const updated = await db.agency.update({
    where: { id: agencyId },
    data: {
      customDomainStatus: result.verified ? "VERIFIED" : "PENDING",
      ...(result.verified ? { customDomainVerifiedAt: new Date() } : {}),
    },
    select: DOMAIN_SELECT,
  });

  return { settings: toSettings(updated as AgencyDomainRow), verified: result.verified, detail: result.detail };
}

/* ── 4. Publish / unpublish ──────────────────────────────────────────────── */

/**
 * Go live for the first time, or re-affirm an already-published site.
 *
 * Distinct from `AgencySiteConfig.underConstruction` (see the schema doc
 * comment on `Agency.publishedAt`) — `getSiteLiveness` in
 * `siteConfig.service.ts` requires both `publishedAt !== null` and
 * `!underConstruction` before a visitor sees real content.
 */
export async function publishSite(agencyId: string): Promise<DomainSettings> {
  const updated = await db.agency.update({
    where: { id: agencyId },
    data: { publishedAt: new Date() },
    select: DOMAIN_SELECT,
  });

  return toSettings(updated as AgencyDomainRow);
}

export async function unpublishSite(agencyId: string): Promise<DomainSettings> {
  const updated = await db.agency.update({
    where: { id: agencyId },
    data: { publishedAt: null },
    select: DOMAIN_SELECT,
  });

  return toSettings(updated as AgencyDomainRow);
}
