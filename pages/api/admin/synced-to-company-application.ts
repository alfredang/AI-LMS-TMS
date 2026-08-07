import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { requireRole } from '../../../lib/auth/requireRole';

/**
 * POST /api/admin/synced-to-company-application
 *
 * Body: {
 *   enrolmentIds: string[],              // SSG enrolment references (e.g. "ENR-2608-028670") from the Synced Enrolments list
 *   employer: {
 *     uen: string,
 *     orgName: string,                   // must match a QuickBooks customer for invoicing to work
 *     contactName?: string,
 *     contactDesignation?: string,
 *     contactPhone?: string,
 *     contactEmail?: string,
 *   }
 * }
 *
 * "Promote" already-enrolled EMPLOYER-sponsored enrolments into Company
 * Application rows so the existing Generate Invoice / Check Supporting Document
 * pipeline can act on them. These enrolments arrived via the SSG sync path and
 * never got a company_application row.
 *
 * SAFETY — this route is deliberately inert with respect to enrolment:
 *   - It copies the existing SSG enrolment_id onto the new CA row and sets
 *     auto_enrol_status = 'enroled' (a terminal state). The CA auto-enrol
 *     pipeline only ever acts on rows explicitly passed to it AND short-circuits
 *     SSG enrolment when enrolment_id is already present — so nothing is
 *     re-enrolled or re-sent to SSG.
 *   - It does NOT call bulkProcessCompanyApplications. No grants, invoices, or
 *     emails are triggered here. Those remain deliberate, separate admin actions
 *     in the View Company Application tab.
 *   - Employer identity is supplied by the caller (picked from the QuickBooks
 *     customer list) because the original enrolment never captured it.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const authed = await requireRole(req, res, ['admin', 'trainingProvider', 'developer']);
  if (!authed) return; // requireRole already sent 401/403

  // Cap the batch and accept only well-formed SSG enrolment references. The
  // list now keys on the enrolment reference rather than an enrollment.id UUID,
  // because most of these learners have no native enrollment row yet — that is
  // created the evening before their class, long after SSG confirms them.
  const MAX_BATCH = 300;
  const ENROLMENT_REF_RE = /^ENR-[0-9]{4}-[0-9]{6}$/i;
  const rawIds: string[] = Array.isArray(req.body?.enrolmentIds) ? req.body.enrolmentIds : [];
  const enrolmentIds = [...new Set(rawIds.map((v) => String(v).trim().toUpperCase()))]
    .filter((id) => ENROLMENT_REF_RE.test(id));

  const employer = req.body?.employer ?? {};
  const orgName = String(employer.orgName ?? '').trim();
  const uen = String(employer.uen ?? '').trim();

  if (enrolmentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'Select at least one enrolment.' });
  }
  if (enrolmentIds.length > MAX_BATCH) {
    return res.status(400).json({ success: false, error: `Too many at once — select up to ${MAX_BATCH} enrolments per batch.` });
  }
  if (!orgName) {
    // Without an employer to bill, the invoice step can never find a QuickBooks
    // customer — so we require it up front rather than create dead-end rows.
    return res.status(400).json({ success: false, error: 'Pick the paying company (its name is required for invoicing).' });
  }

  const employerFields = {
    employer_org_name: orgName,
    employer_uen: uen || null,
    employer_contact_name: String(employer.contactName ?? '').trim() || null,
    employer_contact_designation: String(employer.contactDesignation ?? '').trim() || null,
    employer_contact_phone: String(employer.contactPhone ?? '').trim() || null,
    employer_contact_email: String(employer.contactEmail ?? '').trim() || null,
  };

  try {
    await ensureCompanyApplicationsTable();

    // Pull every selected enrolment that is genuinely EMPLOYER-sponsored and not
    // already tracked as a Company Application. Anything filtered out here is
    // reported back as skipped so the admin knows nothing silently vanished.
    // Mirrors the three sources the Synced Enrolments feed unions, so anything
    // visible on that page can actually be converted. Keyed on the enrolment
    // reference; `enrollment` is an optional extra (it supplies phone/email when
    // the learner already has an LMS account).
    const enrolments = await pool.query(
      `SELECT DISTINCT ON (k.k)
         k.k AS id,
         COALESCE(s.enrolment_id, r.enrolment_reference, e.enrolment_id) AS enrolment_id,
         COALESCE(s.enrolment_status, e.enrolment_status::text, r.status) AS enrolment_status,
         COALESCE(NULLIF(TRIM(s.trainee_nric), ''), NULLIF(TRIM(r.learner_nric), ''), e.nric) AS nric,
         COALESCE(NULLIF(TRIM(r.learner_email), ''), NULLIF(TRIM(e.email), ''), au.email) AS email,
         COALESCE(s.course_reference, r.course_ref_code, e.course_reference) AS course_reference,
         COALESCE(NULLIF(TRIM(s.trainee_name), ''), NULLIF(TRIM(r.learner_name), ''), au.full_name) AS full_name,
         lp.tel,
         COALESCE(s.course_title, r.course_title, co.title) AS course_title,
         COALESCE(s.course_run_id, r.course_run_id, cr.course_run_id) AS run_text_ref,
         to_char(COALESCE(cr.start_date, r.start_date), 'DD-MM-YYYY') AS course_start_date
       FROM (SELECT UPPER(TRIM(x)) AS k FROM UNNEST($1::text[]) AS x) k
       LEFT JOIN public.ssg_enrolments s       ON UPPER(TRIM(s.enrolment_id))        = k.k
       LEFT JOIN public.ssg_enrolment_record r ON UPPER(TRIM(r.enrolment_reference)) = k.k
       LEFT JOIN public.enrollment e           ON UPPER(TRIM(e.enrolment_id))        = k.k
       LEFT JOIN public.app_user au            ON au.id = e.user_id
       LEFT JOIN public.learner_profile lp     ON lp.user_id = e.user_id
       LEFT JOIN public.course co              ON co.id = e.course_id
       LEFT JOIN public.course_run cr          ON cr.course_run_id = COALESCE(s.course_run_id, r.course_run_id)
       WHERE COALESCE(s.enrolment_id, r.enrolment_reference, e.enrolment_id) IS NOT NULL
         AND COALESCE(
               s.sponsorship_type,
               r.raw_data #>> '{enrolment,trainee,sponsorshipType}',
               e.course_sponsorship::text, '') ILIKE '%employ%'
         AND NOT EXISTS (
           SELECT 1 FROM public.company_application ca
           WHERE ca.enrolment_id IS NOT NULL
             AND UPPER(TRIM(ca.enrolment_id)) = k.k
         )
       ORDER BY k.k, e.created_at DESC NULLS LAST`,
      [enrolmentIds]
    );

    const eligible = enrolments.rows;
    const eligibleIds = new Set(eligible.map((r: any) => String(r.id)));
    const skipped = enrolmentIds
      .filter((id) => !eligibleIds.has(String(id)))
      .map((id) => ({ id, reason: 'Not eligible (not employer-sponsored, or already a Company Application).' }));

    const createdIds: string[] = [];
    const details: Array<{ id: string; enrolmentId: string; trainee: string }> = [];

    for (const row of eligible) {
      const insertCols: Record<string, any> = {
        course_title: row.course_title ?? null,
        course_start_date: row.course_start_date ?? null,
        trainee_full_name: row.full_name ?? null,
        trainee_nric: row.nric ?? null,
        trainee_email: row.email ?? null,
        trainee_phone: row.tel ?? null,
        ...employerFields,
        course_reference_number: row.course_reference ?? null,
        course_run_id: row.run_text_ref ?? null,
        enrolment_id: row.enrolment_id ?? null,
        enrolment_status: row.enrolment_status ?? null,
        // Terminal state → the auto-enrol pipeline leaves this row alone.
        auto_enrol_status: 'enroled',
      };

      const cols = Object.keys(insertCols);
      const vals = Object.values(insertCols);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

      try {
        const result = await pool.query(
          `INSERT INTO public.company_application (${cols.join(', ')})
           VALUES (${placeholders})
           RETURNING id`,
          vals
        );
        const newId = result.rows[0]?.id;
        if (newId) {
          createdIds.push(newId);
          details.push({ id: newId, enrolmentId: row.enrolment_id ?? '', trainee: row.full_name ?? '' });
        }
      } catch (insertErr: any) {
        // 23505 = the dedup unique index already has a row for this
        // (nric, uen, course, start date). Treat as already-present, not a hard
        // failure — report it as skipped.
        if (insertErr?.code === '23505') {
          skipped.push({ id: String(row.id), reason: 'A Company Application already exists for this learner/course/employer.' });
        } else {
          throw insertErr;
        }
      }
    }

    return res.status(200).json({
      success: true,
      created: createdIds.length,
      skippedCount: skipped.length,
      createdIds,
      details,
      skipped,
    });
  } catch (err: any) {
    console.error('synced-to-company-application error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to add to Company Application.' });
  }
}
