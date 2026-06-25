import type { NextApiRequest, NextApiResponse } from 'next';
import { reconcileEnrolmentCancellations } from '../../../lib/services/reconcileEnrolmentCancellations';

/**
 * External API — Reconcile Enrolment Cancellations
 *
 * Pulls the current TPG status for active local enrolments on recently-ended /
 * near-future course runs and writes cancellations back to the local DB. Closes
 * the gap where a learner cancels on TPG but the local `enrolment_status` stays
 * `Confirmed` (which previously let cancelled learners through assessment/cert
 * guards). See lib/services/reconcileEnrolmentCancellations.ts.
 *
 * POST /api/external/reconcile-enrolment-cancellations
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 * Body (optional): { pastDays?, futureDays?, maxChecks? }
 */
export async function runAutomation() {
  return reconcileEnrolmentCancellations();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) {
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  // Allow scheduler (internal) calls through; otherwise require the API key.
  if (apiKey !== validKey && !req.headers['x-internal-scheduler']) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  try {
    const { pastDays, futureDays, maxChecks } = (req.body || {}) as {
      pastDays?: number; futureDays?: number; maxChecks?: number;
    };
    const result = await reconcileEnrolmentCancellations({ pastDays, futureDays, maxChecks });
    return res.status(200).json(result);
  } catch (err) {
    console.error('❌ reconcile-enrolment-cancellations error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
