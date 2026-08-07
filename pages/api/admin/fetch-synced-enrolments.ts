import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { toDateOnlyIso } from '../../../lib/utils/dateOnly';

// Read-only feed for the "All Synced Enrolments" tab.
//
// Purpose: surface every EMPLOYER-sponsored enrolment the LMS knows about that
// was never registered as a Company Application (no matching
// `company_application` row) — so they are invisible to the View Company
// Application tab.
//
// This used to read `enrollment` alone, on the assumption that the SSG sync
// path writes it. It does not: SSG data lands in `ssg_enrolments` (per-run
// import) and `ssg_enrolment_record` (the daily sweep), while `enrollment` is
// only written by auto-create-learners the evening BEFORE a class, by the CA
// pipeline, or by a manual enrolment. The page therefore hid employer-sponsored
// learners until the night before they attended — 5,333 of 6,981 such
// enrolments had no `enrollment` row at all — and dropped any whose
// course_sponsorship failed to normalise and landed as NULL.
//
// So all three sources are unioned on the enrolment reference. Sponsorship is
// taken from SSG directly (`ssg_enrolments.sponsorship_type`, or
// raw_data.enrolment.trainee.sponsorshipType in the sweep table) rather than
// through the normaliser that can return NULL.
//
// This endpoint DOES NOT WRITE ANYTHING. It is a live query only. It creates
// no company_application rows and triggers none of the CA pipeline
// (enrolment / grant creation / invoice / email). It exists purely so admins
// can SEE these already-enrolled records in one place. Every row here is
// already enrolled with SSG (it has an enrolment reference), so nothing needs
// to be re-processed.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const result = await pool.query(`
      SELECT * FROM (
      WITH employer_keys AS (
        -- Per-run SSG import. Broadest history; sponsorship straight from SSG.
        SELECT LOWER(TRIM(s.enrolment_id)) AS k
          FROM public.ssg_enrolments s
         WHERE s.enrolment_id IS NOT NULL
           AND s.sponsorship_type ILIKE '%employ%'
        UNION
        -- Daily SSG sweep. The only source that fills itself, so this is what
        -- makes a learner visible before the night of their class.
        SELECT LOWER(TRIM(r.enrolment_reference))
          FROM public.ssg_enrolment_record r
         WHERE r.enrolment_reference IS NOT NULL
           AND r.raw_data #>> '{enrolment,trainee,sponsorshipType}' ILIKE '%employ%'
        UNION
        -- Native LMS enrolments (the original source for this page).
        SELECT LOWER(TRIM(e.enrolment_id))
          FROM public.enrollment e
         WHERE e.enrolment_id IS NOT NULL
           AND e.course_sponsorship::text ILIKE '%employ%'
      )
      SELECT DISTINCT ON (k.k)
        k.k AS id,
        COALESCE(s.enrolment_id, r.enrolment_reference, e.enrolment_id)        AS enrolment_id,
        COALESCE(s.enrolment_status, e.enrolment_status::text, r.status)       AS enrolment_status,
        COALESCE(s.enrolment_date, r.enrolment_date, e.enrolment_date)         AS enrolment_date,
        COALESCE(NULLIF(TRIM(s.trainee_nric), ''), NULLIF(TRIM(r.learner_nric), ''), e.nric) AS nric,
        COALESCE(NULLIF(TRIM(r.learner_email), ''), NULLIF(TRIM(e.email), ''), au.email)     AS email,
        COALESCE(s.sponsorship_type,
                 r.raw_data #>> '{enrolment,trainee,sponsorshipType}',
                 e.course_sponsorship::text)                                   AS course_sponsorship,
        COALESCE(NULLIF(TRIM(s.trainee_name), ''), NULLIF(TRIM(r.learner_name), ''), au.full_name) AS full_name,
        lp.company                                                             AS employer_company,
        COALESCE(s.course_title, r.course_title, co.title)                     AS course_title,
        COALESCE(s.course_run_id, r.course_run_id, cr.course_run_id)           AS course_reference_number,
        COALESCE(cr.start_date, r.start_date)                                  AS course_start_date,
        COALESCE(NULLIF(TRIM(e.grant_id), ''), sg.any_grant_id, '')            AS grant_id,
        COALESCE(sg.total_amount, 0)                                           AS grant_amount
      FROM employer_keys k
      LEFT JOIN public.ssg_enrolments s        ON LOWER(TRIM(s.enrolment_id))        = k.k
      LEFT JOIN public.ssg_enrolment_record r  ON LOWER(TRIM(r.enrolment_reference)) = k.k
      LEFT JOIN public.enrollment e            ON LOWER(TRIM(e.enrolment_id))        = k.k
      LEFT JOIN public.app_user au             ON au.id = e.user_id
      LEFT JOIN public.learner_profile lp      ON lp.user_id = e.user_id
      LEFT JOIN public.course co               ON co.id = e.course_id
      LEFT JOIN public.course_run cr           ON cr.course_run_id = COALESCE(s.course_run_id, r.course_run_id)
      LEFT JOIN (
        SELECT
          LOWER(TRIM(enrollment_id)) AS enrolment_key,
          MAX(grant_id) AS any_grant_id,
          SUM(CASE WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
                   ELSE COALESCE(estimated_grant_amount, 0) END) AS total_amount
        FROM public.ssg_grants
        GROUP BY LOWER(TRIM(enrollment_id))
      ) sg ON sg.enrolment_key = k.k
      WHERE NOT EXISTS (
          SELECT 1 FROM public.company_application ca
          WHERE ca.enrolment_id IS NOT NULL
            AND LOWER(TRIM(ca.enrolment_id)) = k.k
        )
        -- Cancelled enrolments are not billable, and showing them invites
        -- someone to raise an invoice for a class nobody is attending.
        AND COALESCE(s.enrolment_status, e.enrolment_status::text, r.status, '') <> 'Cancelled'
        -- Widening the sources exposed the full history: 6,593 of 8,092 of these
        -- are over a year old, which buries the handful that still need
        -- invoicing. Keep the last year plus anything still to come; older rows
        -- are settled business, not work in progress.
        AND (
              COALESCE(s.enrolment_date, r.enrolment_date, e.enrolment_date) >= CURRENT_DATE - INTERVAL '12 months'
           OR COALESCE(cr.start_date, r.start_date) >= CURRENT_DATE
        )
      -- DISTINCT ON needs the key first; a learner can hold more than one
      -- enrollment row for the same reference, so pick one deterministically.
      ORDER BY k.k, e.created_at DESC NULLS LAST
      ) rows
      ORDER BY enrolment_date DESC NULLS LAST
    `);

    const rows = result.rows.map((r: any) => ({
      id: String(r.id),
      enrolmentId: r.enrolment_id ?? '',
      enrolmentStatus: r.enrolment_status ?? '',
      // toISOString() renders in UTC, and these dates are stored as Singapore
      // midnight — so it reported the day before (a 12 Aug class showed as the
      // 11th). toDateOnlyIso formats Date objects in Asia/Singapore.
      enrolmentDate: toDateOnlyIso(r.enrolment_date) ?? '',
      nric: r.nric ?? '',
      email: r.email ?? '',
      sponsorship: r.course_sponsorship ?? '',
      traineeName: r.full_name ?? '',
      employer: r.employer_company ?? '',
      courseTitle: r.course_title ?? '',
      courseReference: r.course_reference_number ?? '',
      courseStartDate: toDateOnlyIso(r.course_start_date) ?? '',
      grantId: r.grant_id ?? '',
      grantAmount: r.grant_amount != null && Number(r.grant_amount) > 0 ? String(r.grant_amount) : '',
    }));

    return res.status(200).json({ rows, total: rows.length });
  } catch (err: any) {
    console.error('fetch-synced-enrolments error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to fetch synced enrolments' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
