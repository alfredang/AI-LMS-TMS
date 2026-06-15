import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/reschedule-learners?courseRunUuid=<uuid>
 *
 * Returns the learners enrolled in a course run for the Rescheduling tab —
 * INCLUDING already-removed ones (Admin Removed / Cancelled / Withdrawn) so the
 * UI can render them greyed with a "(Removed)" label. Same learner fields as
 * class-details.ts, plus enrolment_status + an is_removed flag. Active rows
 * are ordered first.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const courseRunUuid = String(req.query.courseRunUuid || '');
  if (!courseRunUuid) {
    return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
  }

  try {
    const result = await pool.query(
      `SELECT
         au.full_name AS learner_name,
         au.email AS learner_email,
         lp.tel AS learner_tel,
         lp.company AS company,
         e.course_sponsorship AS sponsorship,
         lp.nationality AS nationality,
         e.payment_status AS payment_details,
         e.assessment_status AS assessment,
         COALESCE(
           (SELECT sg.grant_id FROM ssg_grants sg WHERE sg.enrollment_id = e.enrolment_id ORDER BY sg.created_date DESC LIMIT 1),
           e.grant_id
         ) AS grant_id,
         e.enrolment_status,
         (LOWER(COALESCE(e.enrolment_status, '')) IN ('admin removed', 'cancelled', 'withdrawn')) AS is_removed
       FROM enrollment e
       JOIN app_user au ON e.user_id = au.id
       LEFT JOIN learner_profile lp ON e.user_id = lp.user_id
       WHERE e.course_run_id = $1
       ORDER BY is_removed ASC, au.full_name ASC`,
      [courseRunUuid]
    );

    const data = result.rows.map((r) => ({
      learnerName: r.learner_name,
      learnerEmail: r.learner_email,
      learnerTel: r.learner_tel || '',
      company: r.company || '',
      sponsorship: r.sponsorship || '',
      nationality: r.nationality || '',
      paymentDetails: r.payment_details || '',
      assessment: r.assessment || '',
      grantId: r.grant_id || '',
      enrolmentStatus: r.enrolment_status || '',
      isRemoved: r.is_removed === true,
    }));

    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error('❌ [reschedule-learners]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}
