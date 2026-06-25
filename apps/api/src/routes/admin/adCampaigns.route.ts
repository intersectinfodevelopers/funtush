/**
 * Admin ad-campaign routes.
 *
 * Mount this under /admin/ad-campaigns behind requireAdmin (see admin/index.ts).
 * Lives under src/routes/admin/.
 */

import { Router, Response } from "express";
import {
  getPendingCampaigns,
  getActiveCampaigns,
  approveCampaign,
  rejectCampaign,
  pauseCampaign,
  CampaignError,
} from "../../services/adCampaign.service";

const router = Router();

// GET /admin/ad-campaigns/pending — queue from Large-tier agencies
router.get("/pending", async (_req, res) => {
  try {
    const data = await getPendingCampaigns();
    res.json({ data, total: data.length });
  } catch (err) {
    handle(err, res);
  }
});

// GET /admin/ad-campaigns/active — running campaigns with impressions/clicks/spend
router.get("/active", async (_req, res) => {
  try {
    const data = await getActiveCampaigns();
    res.json({ data, total: data.length });
  } catch (err) {
    handle(err, res);
  }
});

// PATCH /admin/ad-campaigns/:id/approve — push live via Meta + Google
router.patch("/:id/approve", async (req, res) => {
  try {
    const campaign = await approveCampaign(req.params.id);
    res.json({ data: campaign });
  } catch (err) {
    handle(err, res);
  }
});

// PATCH /admin/ad-campaigns/:id/reject — body: { reason }
router.patch("/:id/reject", async (req, res) => {
  try {
    const campaign = await rejectCampaign(req.params.id, req.body?.reason);
    res.json({ data: campaign });
  } catch (err) {
    handle(err, res);
  }
});

// PATCH /admin/ad-campaigns/:id/pause — stop a running campaign immediately
router.patch("/:id/pause", async (req, res) => {
  try {
    const campaign = await pauseCampaign(req.params.id);
    res.json({ data: campaign });
  } catch (err) {
    handle(err, res);
  }
});

function handle(err: unknown, res: Response) {
  if (err instanceof CampaignError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error("[ad-campaigns]", err);
  return res.status(500).json({ error: "Internal server error" });
}

export default router;