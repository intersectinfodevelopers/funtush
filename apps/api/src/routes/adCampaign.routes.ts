import { Router } from 'express';
import { authenticateWithRefreshToken } from '../middleware/refreshTokenAuthentication';
import { checkAgencyStatus } from '../middleware/agencyAccess.middleware';
import type { AgencyRequest } from '../types/auth-request';
import { CampaignError } from '../services/adCampaignService';
import type { Response } from 'express';

const router = Router();

/**
 * `CampaignError` already carries the status the service intended
 * (404/403/409/502/...) — its own doc comment says so — but every handler
 * below used to hardcode 400 or 500 regardless, so a "not found" or
 * "not authorized" campaign lookup reported 500. This is that mapping.
 */
function respondWithCampaignError(res: Response, err: unknown, fallback: number): void {
  if (err instanceof CampaignError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(fallback).json({ error: err instanceof Error ? err.message : 'Something went wrong' });
}

/**
 * @openapi
 * /agencies/me/ad-campaigns/generate:
 *   post:
 *     tags: [Ad Campaigns]
 *     summary: Generate a draft ad campaign (3 creative variations) from the agency's published packages
 *     security: [{ refreshToken: [] }]
 *     responses:
 *       201: { description: Draft campaign created, status PENDING }
 *       400: { description: No published packages found }
 *       401: { description: Unauthorized }
 */
router.post(
  '/generate',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { generateAdCampaign } = await import('../services/adCampaignService');
      const result = await generateAdCampaign(agencyId);

      res.status(201).json({
        success: true,
        message: 'Ad campaign created with 3 creative variations',
        data: result,
      });
    } catch (err) {
      console.error('Ad campaign generation error:', err);
      respondWithCampaignError(res, err, 400);
    }
  }
);

/**
 * @openapi
 * /agencies/me/ad-campaigns:
 *   get:
 *     tags: [Ad Campaigns]
 *     summary: List the agency's own ad campaigns
 *     security: [{ refreshToken: [] }]
 *     responses:
 *       200: { description: Campaigns }
 *       401: { description: Unauthorized }
 */
router.get(
  '/',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { getCampaigns } = await import('../services/adCampaignService');
      const campaigns = await getCampaigns(agencyId);

      res.json({
        success: true,
        data: campaigns,
      });
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  }
);

/**
 * @openapi
 * /agencies/me/ad-campaigns/{id}:
 *   get:
 *     tags: [Ad Campaigns]
 *     summary: Get one of the agency's own campaigns
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Campaign }
 *       403: { description: Owned by a different agency }
 *       404: { description: Not found }
 */
router.get(
  '/:id',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { id } = req.params as { id: string }; 
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { getCampaign } = await import('../services/adCampaignService');
      const campaign = await getCampaign(id, agencyId);

      res.json({
        success: true,
        data: campaign,
      });
    } catch (err) {
      console.error('Failed to fetch campaign:', err);
      respondWithCampaignError(res, err, 500);
    }
  }
);

/**
 * @openapi
 * /agencies/me/ad-campaigns/{id}/performance:
 *   get:
 *     tags: [Ad Campaigns]
 *     summary: Sync and return a campaign's impressions/clicks/spend (only calls the ad platform once the campaign has been pushed live)
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Performance metrics }
 *       400: { description: Not found or not authorized }
 */
router.get(
  '/:id/performance',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { id } = req.params as { id: string };
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { syncAndGetCampaignPerformance } = await import(
        '../services/adPerformanceService'
      );

      const performance = await syncAndGetCampaignPerformance(
        id,
        agencyId
      );

      res.json({
        success: true,
        data: performance,
      });
    } catch (err) {
      console.error('Failed to fetch campaign performance:', err);

      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to fetch performance data',
      });
    }
  }
);

/**
 * @openapi
 * /agencies/me/ad-campaigns/{id}/targeting:
 *   post:
 *     tags: [Ad Campaigns]
 *     summary: Set a PENDING (draft) campaign's targeting parameters
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Invalid targeting, or campaign is not PENDING }
 */
router.post(
  '/:id/targeting',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { id } = req.params as { id: string };
      const agencyId = req.agencyId;
      const targetingParams = req.body;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { updateTargetingParams } = await import(
        '../services/targetingBuilderService'
      );
      const updated = await updateTargetingParams(id, agencyId, targetingParams);

      res.json({
        success: true,
        message: 'Targeting parameters updated',
        data: updated,
      });
    } catch (err) {
      console.error('Targeting update error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to update targeting',
      });
    }
  }
);

/**
 * @openapi
 * /agencies/me/ad-campaigns/{id}/submit:
 *   post:
 *     tags: [Ad Campaigns]
 *     summary: Submit a PENDING campaign (with targeting already set) for admin review — moves it to PENDING_APPROVAL
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Submitted }
 *       400: { description: Campaign is not PENDING, or has no targeting parameters yet }
 */
router.post(
  '/:id/submit',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { id } = req.params as { id: string };
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { submitCampaignForApproval } = await import(
        '../services/targetingBuilderService'
      );
      const submitted = await submitCampaignForApproval(id, agencyId);

      res.json({
        success: true,
        message: 'Campaign submitted for admin review',
        data: submitted,
      });
    } catch (err) {
      console.error('Campaign submission error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to submit campaign',
      });
    }
  }
);

/**
 * @openapi
 * /agencies/me/ad-campaigns/targeting/options:
 *   get:
 *     tags: [Ad Campaigns]
 *     summary: The static targeting option catalog (regions, interests, etc.)
 *     security: [{ refreshToken: [] }]
 *     responses:
 *       200: { description: Options }
 */
router.get(
  '/targeting/options',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { getTargetingOptions } = await import(
        '../services/targetingBuilderService'
      );
      const options = await getTargetingOptions();

      res.json({
        success: true,
        data: options,
      });
    } catch (err) {
      console.error('Failed to fetch targeting options:', err);
      res.status(500).json({ error: 'Failed to fetch targeting options' });
    }
  }
);

export default router;