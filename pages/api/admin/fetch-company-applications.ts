import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';

const DB_TO_COLUMN: Record<string, string> = {
  course_title: 'Course Title*',
  course_start_date: 'Course Start Date (DD-MM-YYYY)*',
  trainee_identity_type: 'Trainee Identity Type*',
  trainee_full_name: 'Trainee FULL Name as on government ID*',
  trainee_id_type: 'Trainee ID Type*',
  trainee_nric: 'Trainee NRIC/FIN Number*',
  date_of_birth: 'Date of Birth* (DD-MM-YYYY)',
  trainee_email: 'Trainee Company email Address*',
  trainee_phone: 'Trainee Mobile Phone Number*',
  trainee_highest_qualification: 'Trainee Highest Qualification*',
  employer_org_name: 'Employer Organization Name*',
  employer_uen: 'Employer UEN*',
  employer_contact_name: 'Employer Contact Name*',
  employer_contact_designation: 'Employer Contact Designation*',
  employer_contact_phone: 'Employer Contact Telephone No.*',
  employer_contact_email: 'Employer Contact Email Address*',
  ssg_funding_before: 'Have trainee(s) been given SSG funding before for the course applying for?',
  consent_ssg_terms: 'Consent to SSG funding terms, attendance, assessment, and full-fee liability if requirements are not met',
  declaration_truthful: 'Declaration that all grant application information is true and accurate',
  consent_marketing: 'Consent to receive marketing information via newsletter',
  grant_application_nos: 'Grant Application Nos (For TP to fill only after grant approved)',
  course_reference_number: 'Course Reference Number',
  course_run_id: 'Course Run ID',
  enrolment_id: 'Enrolment ID',
  enrolment_status: 'Enrolment Status',
  bl_grant_id: 'Grant ID (BL)',
  bl_amount: 'Amt (BL)',
  other_grant_id: 'Grant ID',
  other_scheme_code: 'Scheme',
  other_amount: 'Amount',
  tg_amount: 'TG Amt',
  auto_enrol_status: 'Auto-Enrol Status',
  auto_enrol_error: 'Auto-Enrol Error',
  calendar_added: 'Calendar Added',
  grant_ineligible: 'Grant Ineligible',
  billed_manually: 'Billed Manually',
  billed_manually_invoice_ref: 'Billed Manually Invoice Ref',
  invoice_id: 'Invoice ID',
  invoice_doc_number: 'Invoice Doc Number',
  invoice_drive_file_id: 'Invoice Drive File ID',
  invoice_drive_web_view_link: 'Invoice Drive Link',
  invoice_sent_at: 'Invoice Sent At',
  invoice_sent_to: 'Invoice Sent To',
  grant_invoice_id: 'Grant Invoice ID',
  grant_invoice_doc_number: 'Grant Invoice Doc Number',
  grant_invoice_drive_file_id: 'Grant Invoice Drive File ID',
  grant_invoice_drive_web_view_link: 'Grant Invoice Drive Link',
  supporting_doc_drive_file_id: 'Supporting Doc Drive File ID',
  supporting_doc_drive_web_view_link: 'Supporting Doc Drive Link',
  supporting_doc_uploaded_at: 'Supporting Doc Uploaded At',
  supporting_doc_verification_status: 'Supporting Doc Verification Status',
  supporting_doc_verified_at: 'Supporting Doc Verified At',
  supporting_doc_verified_by: 'Supporting Doc Verified By',
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    await ensureCompanyApplicationsTable();
    const result = await pool.query(`
      SELECT
        ca.id, ca.course_title, ca.course_start_date, ca.trainee_identity_type, ca.trainee_full_name,
        ca.trainee_id_type, ca.trainee_nric, ca.date_of_birth, ca.trainee_email, ca.trainee_phone,
        ca.trainee_highest_qualification, ca.employer_org_name, ca.employer_uen, ca.employer_contact_name,
        ca.employer_contact_designation, ca.employer_contact_phone, ca.employer_contact_email,
        ca.ssg_funding_before, ca.consent_ssg_terms, ca.declaration_truthful, ca.consent_marketing,
        ca.grant_application_nos, ca.course_reference_number, ca.course_run_id, ca.enrolment_id,
        ca.enrolment_status, ca.auto_enrol_status, ca.auto_enrol_error, ca.pipeline_warnings,
        ca.calendar_added, ca.grant_ineligible,
        ca.billed_manually, ca.billed_manually_invoice_ref,
        ca.invoice_id, ca.invoice_doc_number,
        ca.invoice_drive_file_id, ca.invoice_drive_web_view_link,
        ca.invoice_sent_at, ca.invoice_sent_to,
        ca.grant_invoice_id, ca.grant_invoice_doc_number,
        ca.grant_invoice_drive_file_id, ca.grant_invoice_drive_web_view_link,
        ca.supporting_doc_drive_file_id, ca.supporting_doc_drive_web_view_link,
        ca.supporting_doc_uploaded_at, ca.supporting_doc_verification_status,
        ca.supporting_doc_verified_at, ca.supporting_doc_verified_by,
        ca.attention_ignored_at,
        ca.created_at, ca.updated_at,
        ct.course_type::text AS course_type,
        ct.current_code AS course_current_code,
        ct.previous_code AS course_previous_code,
        rn.renewed_on AS course_renewed_on,
        rn.renewed_on_exact AS course_renewed_on_exact,
        sg.bl_grant_id, sg.bl_amount, sg.other_grant_id, sg.other_scheme_code, sg.other_amount, sg.tg_amount
      FROM public.company_application ca
      -- WSQ / CASL / IBF for the Type column, and the SSG references either side
      -- of a renewal. Matched on the course code directly rather than wrapped in
      -- UPPER/TRIM, which keeps the unique index on course_code usable — every
      -- stored code is already uppercase and trimmed.
      LEFT JOIN LATERAL (
          SELECT c.id AS course_id,
                 c.course_type,
                 -- What the course is registered under today. A renewal issues a
                 -- new TGS code and parks it in new_course_code, so a row citing
                 -- anything else was enrolled before that renewal.
                 COALESCE(NULLIF(TRIM(c.new_course_code), ''), c.course_code) AS current_code,
                 -- What it held before, or null when never renewed. Both are
                 -- returned so the screen can show a renewal even for a group
                 -- that enrolled after it and was never on the old code.
                 CASE WHEN NULLIF(TRIM(c.new_course_code), '') IS NOT NULL
                           AND TRIM(COALESCE(c.new_course_code, '')) <> TRIM(COALESCE(c.course_code, ''))
                      THEN c.course_code END AS previous_code
            FROM course c
           WHERE c.course_code = UPPER(TRIM(COALESCE(ca.course_reference_number, '')))
              OR c.new_course_code = UPPER(TRIM(COALESCE(ca.course_reference_number, '')))
           LIMIT 1
      ) ct ON TRUE
      -- When the course stopped being WSQ-funded — the date that decides whether
      -- an invoice raised then SHOULD have said WSQ or CASL.
      --
      -- Two sources, in order of trust:
      --   1. the funding validity that was replaced at renewal (an exact date,
      --      logged as the old value of the fundingValidity change)
      --   2. failing that, when the new TGS code was first recorded — a proxy,
      --      flagged as approximate so nobody reads it as fact
      LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              (SELECT l.old_value
                 FROM course_change_log l
                WHERE l.course_id = ct.course_id
                  AND l.field = 'fundingValidity'
                  AND l.old_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                ORDER BY l.changed_at DESC
                LIMIT 1),
              (SELECT MIN(l.changed_at)::date::text
                 FROM course_change_log l
                WHERE l.course_id = ct.course_id
                  AND l.field = 'newCourseCode')
            ) AS renewed_on,
            EXISTS (SELECT 1 FROM course_change_log l
                     WHERE l.course_id = ct.course_id
                       AND l.field = 'fundingValidity'
                       AND l.old_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AS renewed_on_exact
      ) rn ON TRUE
      LEFT JOIN (
        SELECT
          LOWER(TRIM(enrollment_id)) AS enrolment_key,
          MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) IN ('BL','BASELINE')
                   OR  UPPER(COALESCE(funding_scheme_code,'')) LIKE '%BASELINE%'
              THEN grant_id END) AS bl_grant_id,
          MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) IN ('BL','BASELINE')
                   OR  UPPER(COALESCE(funding_scheme_code,'')) LIKE '%BASELINE%'
              THEN CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                        ELSE COALESCE(estimated_grant_amount,0) END END) AS bl_amount,
          MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                   AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                   AND funding_scheme_code IS NOT NULL
              THEN grant_id END) AS other_grant_id,
          MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                   AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                   AND funding_scheme_code IS NOT NULL
              THEN funding_scheme_code END) AS other_scheme_code,
          MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                   AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                   AND funding_scheme_code IS NOT NULL
              THEN CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                        ELSE COALESCE(estimated_grant_amount,0) END END) AS other_amount,
          SUM(CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                   ELSE COALESCE(estimated_grant_amount,0) END) AS tg_amount
        FROM public.ssg_grants
        GROUP BY LOWER(TRIM(enrollment_id))
      ) sg ON sg.enrolment_key = LOWER(TRIM(ca.enrolment_id))
      ORDER BY ca.created_at DESC
    `);
    const rows = result.rows.map((r: any) => {
      const out: Record<string, any> = { id: r.id };
      Object.entries(DB_TO_COLUMN).forEach(([dbCol, label]) => {
        const v = r[dbCol];
        out[label] = v == null ? '' : String(v);
      });
      // Meta fields used by the UI to highlight rows that need admin attention.
      //
      // `pipeline_warnings` is an APPEND-ONLY history: a step that failed once
      // and succeeded on retry leaves its warning behind forever, and the
      // pipeline even writes non-failures into it ("row recovered ... and
      // restored"). Flagging on "has any warning" therefore marked rows as stuck
      // for the rest of their lives — three fully invoiced learners were showing
      // a red "Auto-enrol failed" while holding a tax invoice, a grant invoice
      // and a calendar entry.
      //
      // A row needs attention when the pipeline gave up on it (`failed`), or
      // when it carries warnings AND has not reached the finish line — no
      // invoice — AND nobody has dismissed it. Anything invoiced is done,
      // whatever it went through on the way.
      const warnings = Array.isArray(r.pipeline_warnings)
        ? r.pipeline_warnings
        : (r.pipeline_warnings ? [] : []);
      const isFailed = String(r.auto_enrol_status || '').trim().toLowerCase() === 'failed';
      const isInvoiced = String(r.invoice_id || '').trim().length > 0;
      const isDismissed = r.attention_ignored_at != null;
      const isStuck = isFailed || (warnings.length > 0 && !isInvoiced && !isDismissed);

      // Read by the Type and Renewal columns.
      out._course_type = String(r.course_type || '');
      out._course_current_code = String(r.course_current_code || '');
      out._course_previous_code = String(r.course_previous_code || '');
      out._course_renewed_on = String(r.course_renewed_on || '');
      out._course_renewed_on_exact = r.course_renewed_on_exact ? '1' : '';

      out._pipeline_warnings = JSON.stringify(warnings);
      out._stuck = isStuck ? '1' : '';
      // Lets the UI title the dialog honestly: a hard failure reads differently
      // from warnings left over from an attempt that eventually worked.
      out._failed = isFailed ? '1' : '';
      return out;
    });
    const stuckCount = rows.filter((r) => r._stuck === '1').length;
    return res.status(200).json({ rows, stuckCount });
  } catch (err: any) {
    console.error('fetch-company-applications error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to fetch company applications' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
