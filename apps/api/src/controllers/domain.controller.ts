/**
 * ── Domain & publish controllers (backend catch-up pass) ──────────────────────
 *
 * Thin, like every sibling in this pass. Dashboard-only, always
 * `private, no-store` — there is no public read for this module (a visitor's
 * browser never fetches "is my custom domain verified yet").
 */

import type { Request, Response } from "express";
import {
  connectDomain,
  disconnectDomain,
  getDomainSettings,
  publishSite,
  unpublishSite,
  verifyDomain,
} from "../services/domain.service";
import type { ConnectDomainInput } from "../validations/domain.validation";

const PRIVATE_NO_STORE = "private, no-store";

function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ success: false, message });
}

function agencyIdOrUnauthorized(req: Request, res: Response): string | null {
  const agencyId = req.agencyId as string | undefined;
  if (!agencyId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return agencyId;
}

/** `GET /agencies/me/domain` — subdomain, custom domain, verification and publish state. */
export async function getMyDomain(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const settings = await getDomainSettings(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, data: settings });
  } catch (err) {
    respondWithError(res, err, "GET /agencies/me/domain");
  }
}

/** `PATCH /agencies/me/domain` — connect (or replace) a custom domain. Paid tiers only (`isPaidTier`). */
export async function patchMyDomain(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const { domain } = req.body as ConnectDomainInput;
    const settings = await connectDomain(agencyId, domain);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, message: "Domain connected — add the DNS records to verify it", data: settings });
  } catch (err) {
    respondWithError(res, err, "PATCH /agencies/me/domain");
  }
}

/** `DELETE /agencies/me/domain` — disconnect the custom domain. */
export async function deleteMyDomain(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const settings = await disconnectDomain(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, message: "Domain disconnected", data: settings });
  } catch (err) {
    respondWithError(res, err, "DELETE /agencies/me/domain");
  }
}

/** `POST /agencies/me/domain/verify` — re-check DNS ownership right now. */
export async function verifyMyDomain(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const result = await verifyDomain(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({
      success: true,
      message: result.detail,
      verified: result.verified,
      data: result.settings,
    });
  } catch (err) {
    respondWithError(res, err, "POST /agencies/me/domain/verify");
  }
}

/** `POST /agencies/me/publish` — go live. */
export async function publishMySite(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const settings = await publishSite(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, message: "Site published", data: settings });
  } catch (err) {
    respondWithError(res, err, "POST /agencies/me/publish");
  }
}

/** `POST /agencies/me/unpublish` — take the site down. */
export async function unpublishMySite(req: Request, res: Response): Promise<void> {
  try {
    const agencyId = agencyIdOrUnauthorized(req, res);
    if (!agencyId) return;

    const settings = await unpublishSite(agencyId);

    res.setHeader("Cache-Control", PRIVATE_NO_STORE);
    res.status(200).json({ success: true, message: "Site unpublished", data: settings });
  } catch (err) {
    respondWithError(res, err, "POST /agencies/me/unpublish");
  }
}
