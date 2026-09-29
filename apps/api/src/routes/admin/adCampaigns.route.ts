/**
 * Admin ad-campaign routes.
 *
 * Mount this under /admin/ad-campaigns behind requireAdmin (see admin/index.ts).
 * Lives under src/routes/admin/.
 *
 * NOTE: requireAdmin (the outer gate applied in admin/index.ts) currently
 * has a dev-only bypass and isn't fully wired (see its TEMP LOCAL BYPASS
 * comment). Since approve/reject/pause can push a real campaign live on
 * Meta and spend budget, those three routes carry their own independent
 * auth gate (requireAuth + requireSuperAdminRole) so they can't fire
 * without a verified platform-admin JWT, regardless of requireAdmin's
 * current state.
 */

import { Router, Response, Request } from "express";
import { requireAuth } from "@funtush/auth";
import { requireSuperAdminRole } from "../../middleware/requireSuperAdminRole.middleware";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware";
import { parsePagination, buildMeta } from "../../utils/pagination.js";
import {
  getPendingCampaigns,
  getActiveCampaigns,
  countPendingCampaigns,
  countActiveCampaigns,
  approveCampaign,
  rejectCampaign,
  pauseCampaign,
  CampaignError,
} from "../../services/adCampaign.service";

const router = Router();

// GET /admin/ad-campaigns/pending — queue from Large-tier agencies
// (read-only — delegable to "ad_campaigns"; approve/reject/pause below stay
// SUPER_ADMIN/PLATFORM_ADMIN-only since they spend real budget on Meta).
router.get("/pending", requireAuth, requirePlatformPermission("ad_campaigns"), async (req, res) => {
  try {
    const page = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const [data, total] = await Promise.all([getPendingCampaigns({ skip: page.skip, take: page.take }), countPendingCampaigns()]);
    res.json({ data, total, meta: buildMeta(total, page.page, page.limit) });
  } catch (err) {
    handle(err, res);
  }
});

// GET /admin/ad-campaigns/active — running campaigns with impressions/clicks/spend
router.get("/active", requireAuth, requirePlatformPermission("ad_campaigns"), async (req, res) => {
  try {
    const page = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const [data, total] = await Promise.all([getActiveCampaigns({ skip: page.skip, take: page.take }), countActiveCampaigns()]);
    res.json({ data, total, meta: buildMeta(total, page.page, page.limit) });
  } catch (err) {
    handle(err, res);
  }
});

// PATCH /admin/ad-campaigns/:id/approve — push live via Meta (Google: TODO)
router.patch(
  "/:id/approve",
  requireAuth,
  requireSuperAdminRole,
  async (req: Request<{ id: string }>, res) => {
    try {
      const campaign = await approveCampaign(req.params.id);
      res.json({ data: campaign });
    } catch (err) {
      handle(err, res);
    }
  }
);

// PATCH /admin/ad-campaigns/:id/reject — body: { reason }
router.patch(
  "/:id/reject",
  requireAuth,
  requireSuperAdminRole,
  async (req: Request<{ id: string }>, res) => {
    try {
      const { reason } = req.body;
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "reason is required and must be a string" });
      }
      const campaign = await rejectCampaign(req.params.id, reason);
      res.json({ data: campaign });
    } catch (err) {
      handle(err, res);
    }
  }
);

// PATCH /admin/ad-campaigns/:id/pause — stop a running campaign immediately
router.patch(
  "/:id/pause",
  requireAuth,
  requireSuperAdminRole,
  async (req: Request<{ id: string }>, res) => {
    try {
      const campaign = await pauseCampaign(req.params.id);
      res.json({ data: campaign });
    } catch (err) {
      handle(err, res);
    }
  }
);

function handle(err: unknown, res: Response) {
  if (err instanceof CampaignError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error("[ad-campaigns]", err);
  return res.status(500).json({ error: "Internal server error" });
}

export default router;