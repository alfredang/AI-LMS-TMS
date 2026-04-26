import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// GET ?courseRunId=UUID
// Returns enrolled learners for a course run
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  if (!courseRunId) {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    const result = await pool.query(
      `SELECT
         au.id AS user_id,
         au.full_name,
         au.email,
         au.secondary_email,
         lp.nric,
         lp.tel,
         e.course_sponsorship AS sponsorship_type,
         e.enrolment_id,
         COALESCE((SELECT sg.grant_id FROM ssg_grants sg WHERE sg.enrollment_id = e.enrolment_id ORDER BY sg.created_date DESC LIMIT 1), e.grant_id) AS grant_id,
         COALESCE((SELECT COALESCE(NULLIF(sg.approved_grant_amount, 0), sg.estimated_grant_amount) FROM ssg_grants sg WHERE sg.enrollment_id = e.enrolment_id ORDER BY sg.created_date DESC LIMIT 1), e.grant_amount::numeric) AS grant_amount,
         (SELECT sc.claim_amount FROM ssg_claims sc WHERE sc.enrollment_id = e.enrolment_id ORDER BY sc.created_date DESC LIMIT 1) AS sf_claim_amount
       FROM enrollment e
       JOIN app_user au ON au.id = e.user_id
       LEFT JOIN learner_profile lp ON lp.user_id = au.id
       WHERE e.course_run_id = $1
         AND e.enrolment_status IS DISTINCT FROM 'Admin Removed'
       ORDER BY au.full_name ASC`,
      [courseRunId]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
