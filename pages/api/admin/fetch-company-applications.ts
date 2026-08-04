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
        ca.calendar_added, ca.grant_ineligible, ca.invoice_id, ca.invoice_doc_number,
        ca.invoice_drive_file_id, ca.invoice_drive_web_view_link,
        ca.invoice_sent_at, ca.invoice_sent_to,
        ca.grant_invoice_id, ca.grant_invoice_doc_number,
        ca.grant_invoice_drive_file_id, ca.grant_invoice_drive_web_view_link,
        ca.supporting_doc_drive_file_id, ca.supporting_doc_drive_web_view_link,
        ca.supporting_doc_uploaded_at, ca.supporting_doc_verification_status,
        ca.supporting_doc_verified_at, ca.supporting_doc_verified_by,
        ca.created_at, ca.updated_at,
        sg.bl_grant_id, sg.bl_amount, sg.other_grant_id, sg.other_scheme_code, sg.other_amount, sg.tg_amount
      FROM public.company_application ca
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
      // Meta fields used by the UI to highlight rows that need admin
      // attention. _pipeline_warnings carries the raw warning array so the
      // UI can render a tooltip listing every failed step; _stuck is a
      // pre-computed flag combining hard failures (auto_enrol_status =
      // 'failed') with any non-empty warnings — letting the UI add a
      // single "stuck-only" filter without re-deriving the logic.
      const warnings = Array.isArray(r.pipeline_warnings)
        ? r.pipeline_warnings
        : (r.pipeline_warnings ? [] : []);
      const isFailed = String(r.auto_enrol_status || '').trim().toLowerCase() === 'failed';
      const isStuck = isFailed || warnings.length > 0;
      out._pipeline_warnings = JSON.stringify(warnings);
      out._stuck = isStuck ? '1' : '';
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
