import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { pushTrainerToTpgForRun, clearTrainerOnTpgForRun } from '../../../lib/ssg/pushTrainerToTpgForRun';

/**
 * Set / clear the run's TPG-assigned trainer (SSG editCourseRunTrainerOnly), used by the attendee
 * reconcile panel's TPG column.
 *
 *   POST { courseRunId, action: 'push', email }  → push that LOCAL trainer to TPG (becomes the official)
 *   POST { courseRunId, action: 'clear' }         → clear the run's trainer on TPG
 *
 * NOTE: this writes to the REAL SSG/TPGateway (not env-guarded like Google Calendar). The trainer must
 * already be a local course_run_trainer and have an NRIC for the push to succeed (pushTrainerToTpgForRun
 * reports the failure reason otherwise).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const { courseRunId, action, email } = (req.body || {}) as { courseRunId?: string; action?: string; email?: string };
  if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });
  if (action !== 'push' && action !== 'clear') return res.status(400).json({ success: false, error: "action must be 'push' or 'clear'" });
  if (action === 'push' && (!email || !email.trim())) return res.status(400).json({ success: false, error: 'email is required for push' });

  try {
    const run = (await pool.query<{ id: string }>(
      `SELECT id FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`, [String(courseRunId)]
    )).rows[0];
    if (!run) return res.status(404).json({ success: false, error: 'Course run not found' });

    const result = action === 'push'
      ? await pushTrainerToTpgForRun(run.id, { onlyEmail: String(email).trim().toLowerCase() })
      : await clearTrainerOnTpgForRun(run.id);

    const ok = result.status === 'synced' || result.status === 'skipped_no_trainer';
    return res.status(200).json({ success: ok, status: result.status, message: result.message, ssgStatus: (result as any).ssgStatus });
  } catch (err: any) {
    console.error('❌ [run-trainer-tpg]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to update TPG trainer' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
