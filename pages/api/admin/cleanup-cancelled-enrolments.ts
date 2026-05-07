import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/admin/cleanup-cancelled-enrolments
 *
 * Finds all enrollment rows where enrolment_status is already 'Cancelled'
 * in the local DB but the learner still appears in class lists (i.e. the
 * status was set but the code wasn't filtering it out before the fix).
 *
 * Also catches rows where ssg_enrolments shows cancelled but local
 * enrollment.enrolment_status was never updated.
 *
 * Query params:
 *   dryRun=1  (default) — preview only, no changes
 *   dryRun=0            — apply the fix
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  const dryRun = req.query.dryRun !== '0';

  try {
    // Find enrollment rows that should be marked Cancelled
    const previewResult = await pool.query(`
      SELECT
        e.id AS enrollment_uuid,
        au.full_name AS learner_name,
        au.email,
        e.enrolment_id,
        e.enrolment_status AS current_status,
        cr.course_run_id,
        c.title AS course_title,
        CASE
          WHEN LOWER(COALESCE(se.status, '')) = 'cancelled' THEN 'ssg_enrolments says cancelled'
          WHEN LOWER(COALESCE(e.enrolment_status, '')) = 'cancelled' THEN 'already cancelled locally (filter fix only)'
          ELSE 'unknown'
        END AS reason
      FROM enrollment e
      JOIN app_user au ON au.id = e.user_id
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c ON c.id = e.course_id
      LEFT JOIN ssg_enrolments se ON se.enrolment_ref = e.enrolment_id
      WHERE (
        LOWER(COALESCE(se.status, '')) = 'cancelled'
        OR LOWER(COALESCE(e.enrolment_status, '')) = 'cancelled'
      )
      AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed')
      ORDER BY cr.course_run_id, au.full_name
    `);

    if (dryRun) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        message: `Found ${previewResult.rows.length} enrollment(s) to clean up. Re-run with ?dryRun=0 to apply.`,
        data: previewResult.rows,
      });
    }

    // Apply: mark any not-yet-cancelled rows as Cancelled
    const updateResult = await pool.query(`
      UPDATE enrollment
      SET enrolment_status = 'Cancelled', updated_at = NOW()
      WHERE id IN (
        SELECT e.id
        FROM enrollment e
        LEFT JOIN ssg_enrolments se ON se.enrolment_ref = e.enrolment_id
        WHERE LOWER(COALESCE(se.status, '')) = 'cancelled'
          AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled')
      )
    `);

    // Signal affected learners to refresh
    await pool.query(`
      UPDATE app_user
      SET courses_updated_at = NOW()
      WHERE id IN (
        SELECT DISTINCT e.user_id
        FROM enrollment e
        LEFT JOIN ssg_enrolments se ON se.enrolment_ref = e.enrolment_id
        WHERE LOWER(COALESCE(se.status, '')) = 'cancelled'
          OR LOWER(COALESCE(e.enrolment_status, '')) = 'cancelled'
      )
    `);

    return res.status(200).json({
      success: true,
      dryRun: false,
      message: `Updated ${updateResult.rowCount} enrollment(s) to Cancelled. ${previewResult.rows.length} total affected.`,
      updated: updateResult.rowCount,
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
