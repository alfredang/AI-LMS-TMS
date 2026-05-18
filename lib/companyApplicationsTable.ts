import pool from './db';

let ensurePromise: Promise<void> | null = null;

const ORDERED_COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'course_title', type: 'text' },
  { name: 'course_start_date', type: 'text' },
  { name: 'trainee_identity_type', type: 'text' },
  { name: 'trainee_full_name', type: 'text' },
  { name: 'trainee_id_type', type: 'text' },
  { name: 'trainee_nric', type: 'text' },
  { name: 'date_of_birth', type: 'text' },
  { name: 'trainee_email', type: 'text' },
  { name: 'trainee_phone', type: 'text' },
  { name: 'trainee_highest_qualification', type: 'text' },
  { name: 'employer_org_name', type: 'text' },
  { name: 'employer_uen', type: 'text' },
  { name: 'employer_contact_name', type: 'text' },
  { name: 'employer_contact_designation', type: 'text' },
  { name: 'employer_contact_phone', type: 'text' },
  { name: 'employer_contact_email', type: 'text' },
  { name: 'ssg_funding_before', type: 'text' },
  { name: 'consent_ssg_terms', type: 'text' },
  { name: 'declaration_truthful', type: 'text' },
  { name: 'consent_marketing', type: 'text' },
  { name: 'grant_application_nos', type: 'text' },
  { name: 'course_reference_number', type: 'text' },
  { name: 'course_run_id', type: 'text' },
  { name: 'enrolment_id', type: 'text' },
  { name: 'enrolment_status', type: 'text' },
  { name: 'grant_id', type: 'text' },
  { name: 'grant_amount', type: 'numeric' },
  { name: 'auto_enrol_status', type: 'text' },
  { name: 'auto_enrol_error', type: 'text' },
  { name: 'calendar_added', type: 'boolean DEFAULT false' },
  // Marks a learner as permanently grant-ineligible (e.g. non-citizen, age
  // out of band). Set via the View page toggle. The invoice guard treats
  // these rows as if they had a grant — so the group can be billed at full
  // fee for the ineligible learner without blocking the rest of the group.
  { name: 'grant_ineligible', type: 'boolean DEFAULT false' },
  { name: 'invoice_id', type: 'text' },
  { name: 'invoice_doc_number', type: 'text' },
  { name: 'invoice_drive_file_id', type: 'text' },
  { name: 'invoice_drive_web_view_link', type: 'text' },
  { name: 'invoice_sent_at', type: 'timestamptz' },
  { name: 'invoice_sent_to', type: 'text' },
  { name: 'grant_invoice_id', type: 'text' },
  { name: 'grant_invoice_doc_number', type: 'text' },
  { name: 'grant_invoice_drive_file_id', type: 'text' },
  { name: 'grant_invoice_drive_web_view_link', type: 'text' },
];

export function ensureCompanyApplicationsTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const columnDefs = ORDERED_COLUMNS.map(c => `${c.name} ${c.type}`).join(',\n        ');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.company_application (
          id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
          ${columnDefs},
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      for (const col of ORDERED_COLUMNS) {
        await pool.query(
          `ALTER TABLE public.company_application ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
        );
      }

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_company_application_employer_uen
          ON public.company_application(employer_uen);
        CREATE INDEX IF NOT EXISTS idx_company_application_trainee_email
          ON public.company_application(trainee_email);
        CREATE INDEX IF NOT EXISTS idx_company_application_dedup
          ON public.company_application (
            LOWER(TRIM(COALESCE(trainee_nric, ''))),
            LOWER(TRIM(COALESCE(employer_uen, ''))),
            LOWER(TRIM(COALESCE(course_title, ''))),
            LOWER(TRIM(COALESCE(course_start_date, '')))
          );
      `);

      // Belt-and-braces: a UNIQUE partial index that physically prevents two
      // concurrent uploads from inserting duplicate (trainee, employer, course,
      // start-date) rows. The application-layer SELECT-then-INSERT pattern in
      // upload-company-applications.ts can race; this stops the race at the DB.
      //
      // Partial (WHERE clause) so incomplete rows (missing nric/title/date)
      // are NOT constrained — those are bad data that should be caught by
      // validation, not blocked at the DB layer with an opaque 23505 error.
      //
      // Existing duplicates would block index creation, so we collapse them
      // first by keeping the newest row per dedup key and deleting the rest.
      // Safe because the collapsed rows have identical critical fields.
      await pool.query(`
        WITH dups AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY
                     LOWER(TRIM(trainee_nric)),
                     LOWER(TRIM(COALESCE(employer_uen, ''))),
                     LOWER(TRIM(course_title)),
                     LOWER(TRIM(course_start_date))
                   ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                 ) AS rn
            FROM public.company_application
           WHERE trainee_nric IS NOT NULL AND trainee_nric <> ''
             AND course_title IS NOT NULL AND course_title <> ''
             AND course_start_date IS NOT NULL AND course_start_date <> ''
        )
        DELETE FROM public.company_application
         WHERE id IN (SELECT id FROM dups WHERE rn > 1);
      `);

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_company_application_dedup
          ON public.company_application (
            LOWER(TRIM(trainee_nric)),
            LOWER(TRIM(COALESCE(employer_uen, ''))),
            LOWER(TRIM(course_title)),
            LOWER(TRIM(course_start_date))
          )
          WHERE trainee_nric IS NOT NULL AND trainee_nric <> ''
            AND course_title IS NOT NULL AND course_title <> ''
            AND course_start_date IS NOT NULL AND course_start_date <> '';
      `);
    })();

    // Reset on rejection so a transient failure on first boot doesn't poison
    // the singleton forever — next call will re-attempt setup.
    ensurePromise.catch(() => {
      ensurePromise = null;
    });
  }

  return ensurePromise;
}
