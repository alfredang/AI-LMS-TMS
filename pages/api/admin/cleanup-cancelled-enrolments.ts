import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/admin/cleanup-cancelled-enrolments
 *
 * Finds all enrollment rows where enrolment_status is 'Cancelled' or
 * 'Withdrawn' — these are already correctly marked but were previously
 * not filtered out of class lists and courseware access.
 *
 * This endpoint simply lists them (dry run) or signals affected learners
 * to refresh their course lists (apply mode).
 *
 * Query params:
 *   dryRun=1  (default) — preview only
 *   dryRun=0            — signal affected learners to refresh
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  const dryRun = req.query.dryRun !== '0';

  try {
    // Find all enrollment rows with cancelled/withdrawn status
    const previewResult = await pool.query(`
      SELECT
        e.id AS enrollment_uuid,
        au.full_name AS learner_name,
        au.email,
        e.enrolment_id,
        e.enrolment_status AS current_status,
        cr.course_run_id,
        c.title AS course_title
      FROM enrollment e
      JOIN app_user au ON au.id = e.user_id
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c ON c.id = e.course_id
      WHERE LOWER(COALESCE(e.enrolment_status, '')) IN ('cancelled', 'withdrawn')
      ORDER BY cr.course_run_id, au.full_name
    `);

    if (dryRun) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        message: `Found ${previewResult.rows.length} cancelled/withdrawn enrollment(s). These are now automatically excluded from class lists and courseware after the code update. Run with ?dryRun=0 to signal affected learners to refresh.`,
        count: previewResult.rows.length,
        data: previewResult.rows,
      });
    }

    // Signal affected learners to refresh their course lists
    const signalResult = await pool.query(`
      UPDATE app_user
      SET courses_updated_at = NOW()
      WHERE id IN (
        SELECT DISTINCT e.user_id
        FROM enrollment e
        WHERE LOWER(COALESCE(e.enrolment_status, '')) IN ('cancelled', 'withdrawn')
      )
    `);

    return res.status(200).json({
      success: true,
      dryRun: false,
      message: `Signalled ${signalResult.rowCount} learner(s) to refresh. ${previewResult.rows.length} cancelled/withdrawn enrollment(s) are now excluded from all views.`,
      learnersSignalled: signalResult.rowCount,
      enrollmentsAffected: previewResult.rows.length,
      data: previewResult.rows,
    });
  } catch (error) {
    console.error('cleanup-cancelled-enrolments error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
