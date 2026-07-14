import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { checkLmsReadiness, executeRescheduleFlow } from '../../../lib/rescheduleHelpers';

/**
 * External API — Direct learner reschedule (no MMS queue, immediate execution).
 *
 * POST /api/external/reschedule-learner
 *
 * Moves a learner's enrollment from current_run_id to target_run_id. Executes
 * three steps in order:
 *   1. TPG/SSG enrolment re-point (irreversible commit point — if this fails, nothing local changes)
 *   2. LMS enrollment row update (course_run_id → target)
 *   3. Google Calendar attendee move (remove from current, add to target)
 *
 * Steps 1 and 2 are hard-required. Step 3 is best-effort — a calendar failure
 * does NOT roll back steps 1–2; the response includes calendar_synced=false so
 * the caller knows follow-up is needed.
 *
 * Body: {
 *   current_run_id:  string,  // SSG run ID (e.g. "TGS-123456-01")
 *   target_run_id:   string,  // SSG run ID (e.g. "TGS-123456-02")
 *   learner_email:   string,
 *   skip_readiness?: boolean, // default false — set true only if caller already ran the readiness endpoint
 *   notes?:          string   // audit note stored in logs
 * }
 *
 * Response (success):
 *   { success: true, result: { tpg_synced, enrollment_moved, calendar_synced, ... } }
 *
 * Response (execution failure — TPG or LMS step failed):
 *   { success: false, error: string, result: { tpg_synced, enrollment_moved, ... } }
 *   HTTP 422 — caller should inspect result to decide whether to retry (TPG succeeded but LMS failed)
 *              or abort (TPG failed — nothing changed).
 *
 * Response (readiness gate failed):
 *   { success: false, error: 'Readiness check failed', blockers: string[], lms: {...} }
 *   HTTP 422
 *
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const { current_run_id, target_run_id, learner_email, skip_readiness, notes } = (req.body || {}) as {
    current_run_id?: string;
    target_run_id?: string;
    learner_email?: string;
    skip_readiness?: boolean;
    notes?: string;
  };

  if (!current_run_id?.trim()) return res.status(400).json({ success: false, error: 'current_run_id is required' });
  if (!target_run_id?.trim()) return res.status(400).json({ success: false, error: 'target_run_id is required' });
  if (!learner_email?.trim()) return res.status(400).json({ success: false, error: 'learner_email is required' });

  const query = pool.query.bind(pool);

  // Pre-flight readiness gate — skip only when caller already verified via the readiness endpoint.
  if (!skip_readiness) {
    try {
      const lms = await checkLmsReadiness({ current_run_id: current_run_id.trim(), target_run_id: target_run_id.trim(), learner_email: learner_email.trim() }, query);
      if (!lms.canApprove) {
        return res.status(422).json({
          success: false,
          error: 'Readiness check failed — resolve LMS blockers before executing',
          blockers: lms.blockers,
          lms,
        });
      }
    } catch (err: any) {
      console.error('[external/reschedule-learner] readiness check error:', err);
      return res.status(500).json({ success: false, error: 'Readiness check failed unexpectedly' });
    }
  }

  try {
    console.log(`[external/reschedule-learner] executing: ${current_run_id} → ${target_run_id} for ${learner_email}${notes ? ` (${notes})` : ''}`);

    const result = await executeRescheduleFlow(
      { current_run_id: current_run_id.trim(), target_run_id: target_run_id.trim(), learner_email: learner_email.trim() },
      query,
    );

    if (result.error && (!result.tpg_synced || !result.enrollment_moved)) {
      // Hard failure — one of the required steps failed.
      return res.status(422).json({ success: false, error: result.error, result });
    }

    // Success (calendar_synced may still be false — soft failure, caller handles follow-up).
    return res.status(200).json({ success: true, result });
  } catch (err: any) {
    console.error('[external/reschedule-learner] execute error:', err);
    return res.status(500).json({ success: false, error: 'Reschedule execution failed unexpectedly' });
  }
}
