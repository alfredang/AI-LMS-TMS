import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/admin/da-sync-enrolment
 *
 * Syncs DA applications against the local enrollment table.
 * For each DA row that doesn't already have an enrolment_id, checks
 * if a matching enrollment exists (by trainee NRIC + course_run_id).
 * If found, copies enrolment_id, enrolment_status, and looks up
 * grant_id from ssg_grants if available.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Find DA rows without enrolment that have a matching enrollment record
    const result = await pool.query(`
      UPDATE da_application da
      SET
        enrolment_id = COALESCE(e.enrolment_id, da.enrolment_id),
        enrolment_status = COALESCE(e.enrolment_status, da.enrolment_status),
        updated_at = NOW()
      FROM enrollment e
      JOIN course_run cr ON e.course_run_id = cr.id
      WHERE da.course_run_id = cr.course_run_id
        AND (
          (da.trainee_id IS NOT NULL AND da.trainee_id <> '' AND UPPER(e.nric) = UPPER(da.trainee_id))
          OR (da.trainee_email IS NOT NULL AND da.trainee_email <> '' AND LOWER(COALESCE((SELECT au.email FROM app_user au WHERE au.id = e.user_id), e.email)) = LOWER(da.trainee_email))
        )
        AND (da.enrolment_id IS NULL OR da.enrolment_id = '')
        AND e.enrolment_id IS NOT NULL
        AND e.enrolment_id <> ''
      RETURNING da.id, da.application_id, e.enrolment_id as matched_enrolment_id, e.enrolment_status as matched_status
    `);

    const updated = result.rows.length;

    // Also try to match grant IDs + amounts from ssg_grants for rows that have enrolment_id
    // ssg_grants columns: grant_id (GRN-xxx), enrollment_id (ENR-xxx),
    // approved_grant_amount, estimated_grant_amount, status
    let grantsMatched = 0;
    try {
      const grantResult = await pool.query(`
        UPDATE da_application da
        SET
          grant_id = sg.grant_id,
          grant_amount = CASE
            WHEN COALESCE(sg.approved_grant_amount, '0.00') <> '0.00' THEN sg.approved_grant_amount
            ELSE sg.estimated_grant_amount
          END,
          updated_at = NOW()
        FROM ssg_grants sg
        WHERE sg.enrollment_id = da.enrolment_id
          AND da.enrolment_id IS NOT NULL
          AND da.enrolment_id <> ''
          AND (da.grant_id IS NULL OR da.grant_id = '')
          AND sg.grant_id IS NOT NULL
        RETURNING da.id, sg.grant_id, sg.approved_grant_amount, sg.estimated_grant_amount
      `);
      grantsMatched = grantResult.rows.length;
    } catch (grantErr) {
      console.warn('⚠️ Grant sync failed (non-fatal):', grantErr instanceof Error ? grantErr.message : grantErr);
    }

    console.log(`✅ [da-sync-enrolment] Matched ${updated} enrolments, ${grantsMatched} grants`);

    return res.status(200).json({
      success: true,
      enrolmentsMatched: updated,
      grantsMatched,
      details: result.rows,
    });
  } catch (err) {
    console.error('❌ da-sync-enrolment error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
