import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { pullRunTpgTrainer } from '../../../lib/ssg/pushTrainerToTpgForRun';
import { collectRunTaggedTrainers } from '../../../lib/trainers/collectRunTrainers';

/**
 * POST { courseRunId } — refresh ONE run's trainer from SSG/TPGateway and return the merged
 * tagged trainer list (LMS + accepted + freshly-pulled TPG). Called on-demand when a calendar
 * event modal / reschedule People modal opens (per-run, not the whole grid). Best-effort:
 * returns the cached tagged list even if the SSG pull fails.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const { courseRunId } = (req.body || {}) as { courseRunId?: string };
  if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });

  try {
    const run = (await pool.query<{ id: string }>(
      `SELECT id FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`, [String(courseRunId)]
    )).rows[0];
    if (!run) return res.status(404).json({ success: false, error: 'Course run not found' });

    const pull = await pullRunTpgTrainer(run.id);
    const taggedTrainers = await collectRunTaggedTrainers(run.id);
    return res.status(200).json({ success: true, taggedTrainers, tpgRefreshed: pull.ok, tpgError: pull.ok ? undefined : pull.error });
  } catch (err: any) {
    console.error('❌ [pull-run-trainer]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to refresh trainer' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
