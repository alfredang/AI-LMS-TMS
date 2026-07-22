import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// Read-only feed for the "All Synced Enrolments" tab.
//
// Purpose: surface every EMPLOYER-sponsored enrolment that lives in
// `enrollment` but was never registered as a Company Application (no matching
// `company_application` row). These came in mostly via the SSG sync/import
// path, which writes `enrollment` with course_sponsorship = 'Employer' but
// never creates a CA row — so they are invisible to the View Company
// Application tab.
//
// This endpoint DOES NOT WRITE ANYTHING. It is a live query only. It creates
// no company_application rows and triggers none of the CA pipeline
// (enrolment / grant creation / invoice / email). It exists purely so admins
// can SEE these already-enrolled records in one place. Every row here is
// already enrolled with SSG (it has an enrolment reference), so nothing needs
// to be re-processed.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const result = await pool.query(`
      SELECT
        e.id,
        e.enrolment_id,
        e.enrolment_status,
        e.enrolment_date,
        e.nric,
        e.email,
        e.course_sponsorship::text AS course_sponsorship,
        au.full_name,
        lp.company        AS employer_company,
        co.title          AS course_title,
        cr.course_run_id  AS course_reference_number,
        cr.start_date     AS course_start_date,
        COALESCE(NULLIF(TRIM(e.grant_id), ''), sg.any_grant_id, '') AS grant_id,
        COALESCE(sg.total_amount, 0) AS grant_amount
      FROM public.enrollment e
      LEFT JOIN public.app_user au       ON au.id = e.user_id
      LEFT JOIN public.learner_profile lp ON lp.user_id = e.user_id
      LEFT JOIN public.course_run cr      ON cr.id = e.course_run_id
      LEFT JOIN public.course co          ON co.id = e.course_id
      LEFT JOIN (
        SELECT
          LOWER(TRIM(enrollment_id)) AS enrolment_key,
          MAX(grant_id) AS any_grant_id,
          SUM(CASE WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
                   ELSE COALESCE(estimated_grant_amount, 0) END) AS total_amount
        FROM public.ssg_grants
        GROUP BY LOWER(TRIM(enrollment_id))
      ) sg ON sg.enrolment_key = LOWER(TRIM(e.enrolment_id))
      WHERE e.course_sponsorship::text ILIKE '%employ%'
        AND NOT EXISTS (
          SELECT 1 FROM public.company_application ca
          WHERE ca.enrolment_id IS NOT NULL
            AND LOWER(TRIM(ca.enrolment_id)) = LOWER(TRIM(e.enrolment_id))
        )
      ORDER BY e.enrolment_date DESC NULLS LAST, e.created_at DESC NULLS LAST
    `);

    const rows = result.rows.map((r: any) => ({
      id: String(r.id),
      enrolmentId: r.enrolment_id ?? '',
      enrolmentStatus: r.enrolment_status ?? '',
      enrolmentDate: r.enrolment_date ? new Date(r.enrolment_date).toISOString().slice(0, 10) : '',
      nric: r.nric ?? '',
      email: r.email ?? '',
      sponsorship: r.course_sponsorship ?? '',
      traineeName: r.full_name ?? '',
      employer: r.employer_company ?? '',
      courseTitle: r.course_title ?? '',
      courseReference: r.course_reference_number ?? '',
      courseStartDate: r.course_start_date ? new Date(r.course_start_date).toISOString().slice(0, 10) : '',
      grantId: r.grant_id ?? '',
      grantAmount: r.grant_amount != null && Number(r.grant_amount) > 0 ? String(r.grant_amount) : '',
    }));

    return res.status(200).json({ rows, total: rows.length });
  } catch (err: any) {
    console.error('fetch-synced-enrolments error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to fetch synced enrolments' });
  }
}
