import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { pushEnrolmentToSsgForLearner } from '../../../lib/ssg/pushEnrolmentToSsgForLearner';
import { cancelEnrolmentForLearnerOnRun } from '../../../lib/ssg/mutateEnrolmentForLearner';

/**
 * POST /api/admin/enrol-learner-tpg  { courseRunUuid, userId?, email?, action? }
 *
 * Manage ONE learner's SSG/TPGateway enrolment. Confirm-gated in the UI; hits REAL SSG.
 *   action 'enrol' (default) — create + store enrolment_id. Skips when no NRIC/DOB/phone.
 *   action 'cancel'          — cancel the TPG enrolment and clear the local enrolment_id
 *                              (the learner stays on the local roster).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { courseRunUuid, userId, email, action } = (req.body || {}) as
    { courseRunUuid?: string; userId?: string; email?: string; action?: 'enrol' | 'cancel' };
  if (!courseRunUuid || (!userId && !email)) {
    return res.status(400).json({ success: false, error: 'courseRunUuid and (userId or email) are required' });
  }

  try {
    const learner = { userId: userId || null, email: email || null };
    if (action === 'cancel') {
      const result = await cancelEnrolmentForLearnerOnRun(String(courseRunUuid), learner);
      if (result.status === 'synced' && result.enrolmentRef) {
        await pool.query(
          `UPDATE enrollment SET enrolment_id = NULL, updated_at = NOW()
            WHERE course_run_id = $1 AND enrolment_id = $2
              AND ( ($3::uuid IS NOT NULL AND user_id = $3) OR ($4 <> '' AND LOWER(email) = LOWER($4)) )`,
          [String(courseRunUuid), result.enrolmentRef, userId || null, (email || '').trim()]
        );
      }
      return res.status(200).json({ success: result.status !== 'error', ...result });
    }

    const result = await pushEnrolmentToSsgForLearner(String(courseRunUuid), learner);
    // status:'error' is a real failure; skip/already states are successful no-ops.
    return res.status(200).json({ success: result.status !== 'error', ...result });
  } catch (e: any) {
    return res.status(500).json({ success: false, status: 'error', message: e?.message || 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
