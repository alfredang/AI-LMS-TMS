import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { syncLearnerFromSSG } from '../../../lib/services/billingSync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId } = req.query;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing required parameter: userId' });
  }

  try {
    // Sync fresh SSG data for this learner before querying (never throws)
    await syncLearnerFromSSG(userId);

    // Pull from local enrollment table — now fresh after sync
    const enrolmentResult = await pool.query(
      `SELECT
        e.id,
        e.enrolment_id,
        u.full_name,
        c.title AS course_title,
        cr.course_run_id,
        c.course_code,
        e.enrolment_status,
        e.enrolment_date,
        e.payment_status,
        cr.start_date::text,
        cr.end_date::text,
        c.course_fees_exclude_gst,
        c.course_fees_include_gst,
        c.after_normal_funding,
        c.after_mces_funding,
        c.is_wsq_funded,
        c.is_mces_eligible,
        lp.pro_forma_url
      FROM enrollment e
      JOIN app_user u ON u.id = e.user_id
      LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c ON c.id = e.course_id
      WHERE e.user_id = $1
      ORDER BY e.enrolment_date DESC NULLS LAST, cr.start_date DESC`,
      [userId]
    );

    // Fetch grants from local ssg_grants (now fresh after sync)
    const enrolmentIds = enrolmentResult.rows
      .map(r => r.enrolment_id)
      .filter(Boolean);

    const grantsByEnrolment: Record<string, Array<{
      funding_scheme: string;
      estimated_amount: string;
      approved_amount: string;
      status: string;
    }>> = {};

    if (enrolmentIds.length > 0) {
      const grantResult = await pool.query(
        `SELECT
          enrollment_id,
          funding_scheme_description AS funding_scheme,
          estimated_grant_amount AS estimated_amount,
          approved_grant_amount AS approved_amount,
          status
        FROM ssg_grants
        WHERE enrollment_id = ANY($1)
        ORDER BY enrollment_id, funding_scheme_description`,
        [enrolmentIds]
      );

      for (const grant of grantResult.rows) {
        if (!grantsByEnrolment[grant.enrollment_id]) {
          grantsByEnrolment[grant.enrollment_id] = [];
        }
        grantsByEnrolment[grant.enrollment_id].push({
          funding_scheme: grant.funding_scheme,
          estimated_amount: grant.estimated_amount,
          approved_amount: grant.approved_amount,
          status: grant.status,
        });
      }
    }

    // Merge grants into enrolment records
    const data = enrolmentResult.rows.map(row => ({
      ...row,
      grants: row.enrolment_id ? (grantsByEnrolment[row.enrolment_id] || []) : [],
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[billing/history] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
