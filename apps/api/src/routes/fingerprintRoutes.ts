/**
 * ── NOT MOUNTED — out of scope (API-wide docs/test pass, Batch 0) ────────────
 *
 * Never imported by `app.ts`. This is the device-fingerprint half of an
 * unbuilt fraud-*detection* pipeline (distinct from the fraud *review
 * queue* — `FraudFlag`/`BlocklistEntry`, `services/fraud.service.ts` — which
 * this same pass fixed). The `Fingerprint` Prisma model this file's service
 * layer expects (`services/fingerprintDatabaseService.ts`) has never existed
 * anywhere in this repo's git history — this is genuinely unfinished
 * original work, not a refactor casualty.
 *
 * Deliberately left as-is: designing real fingerprint-matching/fraud-
 * detection heuristics has no existing spec to follow and is a product
 * decision, not a routing or test-coverage gap. Do not mount this without
 * first adding the `Fingerprint` model and deciding what "matches" means.
 */
import { Router, Request, Response } from 'express';
import { FingerprintDatabaseService } from '../services/fingerprintDatabaseService';
const fingerprintRoutes = Router();

/**
 * POST /fingerprint/check
 * Check if fingerprint matches existing fingerprints
 * Does NOT block registration, only flags for review
 */
fingerprintRoutes.post('/check', async (req: Request, res: Response) => {
  try {
    const { fingerprintJson, agencyId, ipAddress } = req.body;

    if (!fingerprintJson || !agencyId) {
      return res.status(400).json({
        error: 'Missing required fields: fingerprintJson, agencyId',
      });
    }

    // Check fingerprint against existing ones
    const checkResult = await FingerprintDatabaseService.checkFingerprint(
      fingerprintJson,
      agencyId
    );

    if (!checkResult.success) {
      console.warn('[FINGERPRINT API] Check failed:', checkResult.error);
      return res.status(500).json({
        error: 'Failed to check fingerprint',
        details: checkResult.error,
      });
    }

    // Store the new fingerprint
    const storeResult = await FingerprintDatabaseService.storeFingerprint({
      agencyId,
      fingerprintHash: checkResult.fingerprint.hash,
      fingerprintJson,
      ipAddress,
      userAgent: req.get('user-agent') || 'Unknown',
    });

    if (!storeResult.success) {
      console.warn('[FINGERPRINT API] Storage failed:', storeResult.error);
      return res.status(500).json({
        error: 'Failed to store fingerprint',
      });
    }

    // If matched, flag for review
    if (checkResult.flaggedForReview) {
      const flagResult = await FingerprintDatabaseService.flagAgencyForReview(
        agencyId,
        checkResult.fingerprint.matchResult.matchedAgencyIds,
        checkResult.fingerprint.matchResult.similarityScore,
        checkResult.reviewReason || 'Fingerprint match detected'
      );

      if (!flagResult.success) {
        console.warn('[FINGERPRINT API] Flagging failed:', flagResult.error);
      }

      console.log(
        `[FINGERPRINT API] Agency flagged: ${agencyId} (Match: ${checkResult.fingerprint.matchResult.similarityScore}%)`
      );
    }

    // IMPORTANT: Registration is NOT blocked, only flagged for review
    return res.json({
      success: true,
      fingerprint: checkResult.fingerprint,
      flaggedForReview: checkResult.flaggedForReview,
      message: checkResult.flaggedForReview
        ? 'Fingerprint match detected. Account flagged for manual review but registration allowed.'
        : 'Fingerprint is unique. No matches found.',
      agencyId,
      fingerprintId: storeResult.fingerprintId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FINGERPRINT API] Error in /check:', message);

    res.status(500).json({
      error: 'Internal server error',
      details: message,
    });
  }
});

/**
 * GET /fingerprint/agency/:agencyId
 * Get all fingerprints for an agency
 */
fingerprintRoutes.get(
  '/agency/:agencyId',
  async (req: Request, res: Response) => {
    try {
      const { agencyId } = req.params;

      if (!agencyId) {
        return res.status(400).json({ error: 'Missing agencyId' });
      }

      const result = await FingerprintDatabaseService.getAgencyFingerprints(
        agencyId
      );

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({
        success: true,
        agencyId,
        fingerprintCount: result.count,
        fingerprints: result.fingerprints,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[FINGERPRINT API] Error in /agency/:agencyId:', message);

      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

/**
 * GET /fingerprint/fraud-flags/:agencyId
 * Get fraud flags for an agency
 */
fingerprintRoutes.get(
  '/fraud-flags/:agencyId',
  async (req: Request, res: Response) => {
    try {
      const { agencyId } = req.params;

      if (!agencyId) {
        return res.status(400).json({ error: 'Missing agencyId' });
      }

      const result = await FingerprintDatabaseService.getAgencyFraudFlags(
        agencyId
      );

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({
        success: true,
        agencyId,
        flagCount: result.count,
        flags: result.flags,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(
        '[FINGERPRINT API] Error in /fraud-flags/:agencyId:',
        message
      );

      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

/**
 * POST /fingerprint/review/:flagId
 * Admin reviews a flagged agency
 */
fingerprintRoutes.post(
  '/review/:flagId',
  async (req: Request, res: Response) => {
    try {
      const { flagId } = req.params;
      const { approved, adminNotes } = req.body;

      if (!flagId || approved === undefined) {
        return res.status(400).json({
          error: 'Missing required fields: flagId, approved',
        });
      }

      const result = await FingerprintDatabaseService.reviewFlaggedAgency(
        flagId,
        approved,
        adminNotes || ''
      );

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      console.log(
        `[FINGERPRINT API] Flag reviewed by admin: ${flagId} (${result.status})`
      );

      res.json({
        success: true,
        flagId: result.flagId,
        status: result.status,
        message: approved
          ? 'Agency approved. Fraud flag cleared.'
          : 'Agency rejected. Manual intervention required.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[FINGERPRINT API] Error in /review/:flagId:', message);

      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

export default fingerprintRoutes;