import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * Resolves the fields the Bulk Update Assessment flow needs (including the FULL trainee
 * NRIC/FIN) for a specific, caller-chosen set of enrolment IDs selected on the Consolidated
 * Finance Data page.
 *
 * Deliberately separate from /api/finance/all-course-runs, which masks trainee_nric in SQL
 * before it ever reaches the browser — that masking must stay in place for the general grid.
 * This endpoint exists ONLY to feed the assessment-update preview for rows the caller already
 * selected, so returning the unmasked NRIC here (needed for SSG's traineeIdType detection) does
 * not widen exposure beyond what the paste-from-Google-Sheet flow already showed on screen.
 */
/** Normalizes an SSG run date (YYYYMMDD or DD/MM/YYYY) to YYYY-MM-DD text, matching all-course-runs.ts. */
const normDateSql = (jsonPathExpr: string) => `(
  CASE
    WHEN (${jsonPathExpr}) ~ '^[0-9]{8}$' THEN
      substr((${jsonPathExpr}), 1, 4) || '-' || substr((${jsonPathExpr}), 5, 2) || '-' || substr((${jsonPathExpr}), 7, 2)
    WHEN (${jsonPathExpr}) ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN
      substr((${jsonPathExpr}), 7, 4) || '-' || substr((${jsonPathExpr}), 4, 2) || '-' || substr((${jsonPathExpr}), 1, 2)
    ELSE NULLIF(trim(${jsonPathExpr}), '')
  END
)`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const enrolmentIds = Array.isArray(req.body?.enrolmentIds)
    ? req.body.enrolmentIds.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : [];
  if (enrolmentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'enrolmentIds array is required' });
  }

  try {
    const result = await pool.query(
      `SELECT
         se.enrolment_id,
         se.trainee_name,
         se.trainee_nric,
         se.course_reference,
         se.course_title,
         se.enrolment_status,
         se.raw_data->'course'->'run'->>'id' AS course_run_number,
         ${normDateSql(`se.raw_data->'course'->'run'->>'startDate'`)} AS start_date,
         ${normDateSql(`se.raw_data->'course'->'run'->>'endDate'`)} AS end_date
       FROM ssg_enrolments se
       WHERE se.enrolment_id = ANY($1::text[])`,
      [enrolmentIds]
    );

    return res.status(200).json({ success: true, rows: result.rows });
  } catch (error) {
    console.error('[ERROR] [finance/assessment-prefill] Failed to fetch:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
