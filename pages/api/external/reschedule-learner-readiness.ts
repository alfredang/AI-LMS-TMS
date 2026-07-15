import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { checkLmsReadiness, checkCalendarReadiness } from '../../../lib/rescheduleHelpers';

/**
 * External API — Pre-flight readiness check for a direct learner reschedule.
 *
 * GET ?current_run_id=<ssg_run_id>&target_run_id=<ssg_run_id>&learner_email=<email>
 *
 * Runs the same LMS + calendar checks as the admin readiness panel, without
 * the live TPG read (TPG is a warning in the execute path, not a hard blocker).
 * Agents should call this before POST /api/external/reschedule-learner to
 * surface blockers before attempting the irreversible TPG commit step.
 *
 * Response: {
 *   success: true,
 *   canExecute: boolean,   // true when LMS blockers are clear (calendar is advisory)
 *   lms: { ... },
 *   cal: { ... },
 *   blockers: string[],    // hard LMS blockers — must be resolved before executing
 *   warnings: string[]     // calendar advisory — execute still allowed
 * }
 *
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const currentRunId = String(req.query.current_run_id || '').trim();
  const targetRunId = String(req.query.target_run_id || '').trim();
  const learnerEmail = String(req.query.learner_email || '').trim();

  if (!currentRunId) return res.status(400).json({ success: false, error: 'current_run_id is required' });
  if (!targetRunId) return res.status(400).json({ success: false, error: 'target_run_id is required' });
  if (!learnerEmail) return res.status(400).json({ success: false, error: 'learner_email is required' });

  try {
    const query = pool.query.bind(pool);

    const [lms, cal] = await Promise.all([
      checkLmsReadiness({ current_run_id: currentRunId, target_run_id: targetRunId, learner_email: learnerEmail }, query),
      checkCalendarReadiness({ current_run_id: currentRunId, target_run_id: targetRunId }, query),
    ]);

    const canExecute = lms.canApprove;
    const warnings: string[] = [...(lms.warnings ?? [])];
    if (cal && cal.blockers.length > 0) {
      warnings.push(...cal.blockers.map((b: string) => `Calendar: ${b}`));
    }

    return res.status(200).json({
      success: true,
      canExecute,
      lms,
      cal,
      blockers: lms.blockers,
      warnings,
    });
  } catch (err: any) {
    console.error('[external/reschedule-learner-readiness] error:', err);
    return res.status(500).json({ success: false, error: 'Readiness check failed' });
  }
}
