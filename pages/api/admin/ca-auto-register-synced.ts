import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { requireRole } from '../../../lib/auth/requireRole';

/**
 * POST /api/admin/ca-auto-register-synced
 *
 * Bulk-promote EMPLOYER-sponsored enrolments that live in `enrollment` but have
 * no `company_application` row (the "Synced Enrolments" the View Company
 * Application tab can't see). This is the one-click version of
 * synced-to-company-application: instead of the admin picking one employer per
 * batch, we auto-fill the employer NAME from the learner's profile
 * (learner_profile.company) so every synced learner appears on the CA view
 * immediately.
 *
 * SAFETY:
 *   - Read side mirrors fetch-synced-enrolments (employer-sponsored, not already
 *     a CA). Insert side mirrors synced-to-company-application EXACTLY.
 *   - Idempotent: only enrolments with NO existing CA row (by enrolment_id) are
 *     inserted; a dedup unique-index hit (23505) is treated as already-present.
 *   - Sets auto_enrol_status='enroled' (terminal) — the CA auto-enrol pipeline
 *     leaves these rows alone, so nothing is re-enrolled or re-sent to SSG.
 *   - Does NOT trigger grants/invoices/emails. Invoicing still needs the
 *     employer→QuickBooks link (done later via the existing Generate Invoice /
 *     "Search QBO & Link" flow). Rows with a blank profile company still appear;
 *     the admin fills the employer at invoice time.
 *   - Bounded per request (LIMIT) so it can't hog a connection.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['admin', 'trainingProvider', 'developer']);
  if (!authed) return; // requireRole already sent 401/403

  const MAX = 500;

  try {
    await ensureCompanyApplicationsTable();

    // Every employer-sponsored enrolment with no CA row yet (mirror of
    // fetch-synced-enrolments), plus the fields the CA row needs.
    const enrolments = await pool.query(
      `SELECT
         e.id,
         e.enrolment_id,
         e.enrolment_status,
         e.nric,
         e.email,
         e.course_reference,
         au.full_name,
         lp.company AS employer_company,
         lp.tel,
         co.title AS course_title,
         cr.course_run_id AS run_text_ref,
         to_char(cr.start_date, 'DD-MM-YYYY') AS course_start_date
       FROM public.enrollment e
       LEFT JOIN public.app_user au        ON au.id = e.user_id
       LEFT JOIN public.learner_profile lp ON lp.user_id = e.user_id
       LEFT JOIN public.course_run cr      ON cr.id = e.course_run_id
       LEFT JOIN public.course co          ON co.id = e.course_id
       WHERE e.course_sponsorship::text ILIKE '%employ%'
         AND NOT EXISTS (
           SELECT 1 FROM public.company_application ca
           WHERE ca.enrolment_id IS NOT NULL
             AND LOWER(TRIM(ca.enrolment_id)) = LOWER(TRIM(e.enrolment_id))
         )
       ORDER BY e.enrolment_date DESC NULLS LAST, e.created_at DESC NULLS LAST
       LIMIT ${MAX + 1}`,
    );

    const eligible = enrolments.rows;
    const truncated = eligible.length > MAX;
    const toProcess = truncated ? eligible.slice(0, MAX) : eligible;

    let created = 0;
    let skipped = 0;

    for (const row of toProcess) {
      const insertCols: Record<string, unknown> = {
        course_title: row.course_title ?? null,
        course_start_date: row.course_start_date ?? null,
        trainee_full_name: row.full_name ?? null,
        trainee_nric: row.nric ?? null,
        trainee_email: row.email ?? null,
        trainee_phone: row.tel ?? null,
        employer_org_name: String(row.employer_company ?? '').trim() || null,
        employer_uen: null,
        course_reference_number: row.course_reference ?? null,
        course_run_id: row.run_text_ref ?? null,
        enrolment_id: row.enrolment_id ?? null,
        enrolment_status: row.enrolment_status ?? null,
        auto_enrol_status: 'enroled', // terminal — pipeline leaves it alone
      };

      const cols = Object.keys(insertCols);
      const vals = Object.values(insertCols);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

      try {
        const result = await pool.query(
          `INSERT INTO public.company_application (${cols.join(', ')})
           VALUES (${placeholders})
           RETURNING id`,
          vals,
        );
        if (result.rows[0]?.id) created++;
      } catch (insertErr: unknown) {
        // 23505 = dedup unique index already has this (nric, uen, course, date).
        if ((insertErr as { code?: string })?.code === '23505') {
          skipped++;
        } else {
          throw insertErr;
        }
      }
    }

    return res.status(200).json({
      success: true,
      created,
      skipped,
      truncated,
      message: truncated
        ? `Registered ${created} — more remain, run again to register the rest.`
        : `Registered ${created} synced enrolment(s).`,
    });
  } catch (err: unknown) {
    console.error('ca-auto-register-synced error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to register synced enrolments',
    });
  }
}
