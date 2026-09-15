/**
 * ── NOT MOUNTED — out of scope (API-wide docs/test pass, Batch 0) ────────────
 *
 * Never imported by `app.ts`. IP/email/behavioral fraud-*detection* logic,
 * distinct from the fraud *review queue* this pass fixed
 * (`services/fraud.service.ts`, `FraudFlag`/`BlocklistEntry`). Four of its
 * five imports below don't resolve — `./ipAnalysisService`,
 * `./emailAnalysisService`, `./behavioralAnalysisService`, and
 * `./fraudDetectionDatabaseService` (case-mismatched; the file that exists
 * is `FraudDetectionDatabaseService.ts`) — and the `IpRegistration`/
 * `AgencyEmail`/`TrialUsage` Prisma models they'd need have never existed
 * anywhere in this repo's git history.
 *
 * Deliberately left as-is: this is a real fraud-detection engine (IP
 * reputation, email-pattern, behavioral-velocity heuristics) with no
 * existing spec or prior implementation to complete — a product design
 * task, not a routing or test-coverage gap.
 */
import { Router, Request, Response } from 'express';
import { IPAnalysisService } from '../services/ipAnalysisService';
import { EmailAnalysisService } from '../services/emailAnalysisService';
import { BehavioralAnalysisService } from '../services/behavioralAnalysisService';
import { FraudDetectionDatabaseService } from '../services/fraudDetectionDatabaseService';

const fraudDetectionRoutes = Router();

interface PreviousTrialRecord {
  agencyId: string;
  daysOfTrial: number;
  featureLimitHits: number;
  packageCount: number;
  guideCount: number;
  profileCompleted: boolean;
  trialStartDate: Date;
  trialEndDate: Date;
}

/**
 * POST /fraud-detection/check-all
 * Comprehensive fraud check using all layers
 */
fraudDetectionRoutes.post('/check-all', async (req: Request, res: Response) => {
  try {
    const { email, ipAddress, agencyId, registrationType } = req.body;

    if (!email || !ipAddress || !agencyId) {
      return res.status(400).json({
        error: 'Missing required fields: email, ipAddress, agencyId',
      });
    }

    const results = {
      email: EmailAnalysisService.analyzeEmail(email),
      ip: await IPAnalysisService.analyzeIP(ipAddress),
      ipPattern: await FraudDetectionDatabaseService.checkIPFraudPattern(ipAddress),
      emailUniqueness: await FraudDetectionDatabaseService.checkEmailUniqueness(email),
    };

    // Record the registration
    if (registrationType) {
      await FraudDetectionDatabaseService.recordIPRegistration(
        agencyId,
        ipAddress,
        registrationType
      );
      await FraudDetectionDatabaseService.recordEmail(agencyId, email);
    }

    // Determine if registration should be blocked
    const shouldBlock =
      results.email.shouldBlock ||
      (results.ip.riskLevel === 'HIGH' && results.ip.torExitNode);
    const shouldFlag =
      results.ipPattern.shouldFlag ||
      results.email.isDisposable ||
      results.ip.isVpnTor;

    // Create fraud flag if needed
    if (shouldFlag && !shouldBlock) {
      const flaggedLayers: string[] = [];
      if (results.ipPattern.shouldFlag) flaggedLayers.push('IP_PATTERN');
      if (results.email.isDisposable) flaggedLayers.push('DISPOSABLE_EMAIL');
      if (results.ip.isVpnTor) flaggedLayers.push('VPN_TOR');

      await FraudDetectionDatabaseService.createFraudFlag(
        agencyId,
        flaggedLayers,
        results.ipPattern.message,
        results.ip.riskLevel
      );
    }

    return res.json({
      success: true,
      agencyId,
      email: {
        analysis: results.email,
        uniqueness: results.emailUniqueness,
      },
      ip: {
        analysis: results.ip,
        pattern: results.ipPattern,
      },
      shouldBlock,
      flagForReview: shouldFlag,
      message: shouldBlock
        ? 'Registration blocked due to high-risk indicators.'
        : shouldFlag
        ? 'Registration flagged for manual review.'
        : 'Registration allowed. No red flags detected.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FRAUD DETECTION API] Error in /check-all:', message);

    res.status(500).json({
      error: 'Internal server error',
      details: message,
    });
  }
});

/**
 * POST /fraud-detection/email/analyze
 * Analyze email for disposable domain and other issues
 */
fraudDetectionRoutes.post('/email/analyze', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email field' });
    }

    const analysis = EmailAnalysisService.analyzeEmail(email);

    res.json({
      success: true,
      email: analysis.email,
      analysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FRAUD DETECTION API] Error in /email/analyze:', message);

    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /fraud-detection/ip/analyze
 * Analyze IP for VPN/Tor usage
 */
fraudDetectionRoutes.post('/ip/analyze', async (req: Request, res: Response) => {
  try {
    const { ipAddress } = req.body;

    if (!ipAddress) {
      return res.status(400).json({ error: 'Missing ipAddress field' });
    }

    const analysis = await IPAnalysisService.analyzeIP(ipAddress);

    res.json({
      success: true,
      ip: ipAddress,
      analysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FRAUD DETECTION API] Error in /ip/analyze:', message);

    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /fraud-detection/ip/pattern
 * Check IP registration pattern (multiple free registrations in 90 days)
 */
fraudDetectionRoutes.post('/ip/pattern', async (req: Request, res: Response) => {
  try {
    const { ipAddress } = req.body;

    if (!ipAddress) {
      return res.status(400).json({ error: 'Missing ipAddress field' });
    }

    const pattern = await FraudDetectionDatabaseService.checkIPFraudPattern(ipAddress);

    res.json({
      success: true,
      ip: ipAddress,
      pattern,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FRAUD DETECTION API] Error in /ip/pattern:', message);

    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /fraud-detection/behavioral/analyze
 * Analyze behavioral patterns for fraud
 */
fraudDetectionRoutes.post(
  '/behavioral/analyze',
  async (req: Request, res: Response) => {
    try {
      const {
        agencyId,
        daysOfTrial,
        featureLimitHits,
        packageCount,
        guideCount,
        profileCompleted,
        fingerprintMatches,
      } = req.body;

      if (!agencyId || daysOfTrial === undefined) {
        return res.status(400).json({
          error: 'Missing required fields: agencyId, daysOfTrial',
        });
      }

      // Get previous trials
      const previousTrials = await FraudDetectionDatabaseService.getPreviousTrialData(
        agencyId
      );

      // Prepare data
      const currentData = {
        agencyId,
        daysOfTrial,
        featureLimitHits: featureLimitHits || 0,
        packageCount: packageCount || 0,
        guideCount: guideCount || 0,
        profileCompleted: profileCompleted || false,
        trialStartDate: new Date(),
        trialEndDate: new Date(),
      };

      const previousData = previousTrials.map((t: PreviousTrialRecord) => ({
        agencyId: t.agencyId,
        trialData: t,
        featureLimitHits: t.featureLimitHits,
      }));

      // Analyze
      const analysis = await BehavioralAnalysisService.analyzeAgencyBehavior(
        agencyId,
        currentData,
        previousData,
        fingerprintMatches || []
      );

      // Flag if needed
      if (analysis.flagForReview) {
        const flaggedPatterns = analysis.patterns
          .filter(p => p.flagForReview)
          .map(p => p.type);

        await FraudDetectionDatabaseService.createFraudFlag(
          agencyId,
          flaggedPatterns,
          analysis.message,
          analysis.overallRisk
        );
      }

      res.json({
        success: true,
        agencyId,
        analysis,
        riskScore: BehavioralAnalysisService.calculateBehavioralRiskScore(analysis),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(
        '[FRAUD DETECTION API] Error in /behavioral/analyze:',
        message
      );

      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /fraud-detection/summary/:agencyId
 * Get fraud detection summary for an agency
 */
fraudDetectionRoutes.get(
  '/summary/:agencyId',
  async (req: Request, res: Response) => {
    try {
      const { agencyId } = req.params;

      if (!agencyId) {
        return res.status(400).json({ error: 'Missing agencyId' });
      }

      const summary = await FraudDetectionDatabaseService.getFraudDetectionSummary(
        agencyId
      );

      res.json({
        success: true,
        agencyId,
        summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[FRAUD DETECTION API] Error in /summary/:agencyId:', message);

      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default fraudDetectionRoutes;